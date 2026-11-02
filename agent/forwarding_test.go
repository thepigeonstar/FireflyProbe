package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestForwardMetrics(t *testing.T) {
	rx, tx, failures, err := readForwardMetrics(strings.NewReader("gost_services 2\ngost_service_transfer_input_bytes_total{service=\"service with space\",client=\"a\\\"b\"} 100 1234\ngost_service_transfer_input_bytes_total{service=\"service-1\"} 200\ngost_service_transfer_output_bytes_total 4e2\ngost_service_handler_errors_total 2\n"))
	if rx != 300 || tx != 400 || failures != 2 || err != nil {
		t.Fatalf("%d %d %d %v", rx, tx, failures, err)
	}
}

func TestForwardMetricsLargeStreamAndFailures(t *testing.T) {
	var raw strings.Builder
	raw.WriteString("gost_services 1\n")
	for i := 0; i < 9000; i++ {
		fmt.Fprintf(&raw, "gost_service_transfer_input_bytes_total{service=\"s\",client=\"client %d\"} 100\n", i)
		fmt.Fprintf(&raw, "gost_service_transfer_output_bytes_total{service=\"s\",client=\"client %d\"} 200\n", i)
	}
	if raw.Len() <= 262144 {
		t.Fatal("fixture must exceed old cap")
	}
	rx, tx, _, err := readForwardMetrics(strings.NewReader(raw.String()))
	if err != nil || rx != 900000 || tx != 1800000 {
		t.Fatalf("%d %d %v", rx, tx, err)
	}
	for _, text := range []string{"gost_services 1\ngost_service_transfer_input_bytes_total NaN\n", "gost_services 1\ngost_service_transfer_output_bytes_total -1\n", "gost_services 1\ngost_service_transfer_input_bytes_total broken\n", "gost_services 1\ngost_service_transfer_input_bytes_total 9e15\n", "# gost_services\n", "gost_services 1\n" + strings.Repeat("x", 65536)} {
		if _, _, _, err := readForwardMetrics(strings.NewReader(text)); err == nil {
			t.Fatal("accepted bad/partial data")
		}
	}
	large := "gost_services 1\n" + strings.Repeat("# padding\n", forwardMetricsLimit/10+1)
	if _, _, _, err := readForwardMetrics(strings.NewReader(large)); err == nil || err.Error() != "metrics_too_large" {
		t.Fatalf("size guard: %v", err)
	}
	if _, _, _, err := readForwardMetrics(&brokenMetricsReader{}); err == nil {
		t.Fatal("accepted interrupted response")
	}
}

type brokenMetricsReader struct{ sent bool }

func (r *brokenMetricsReader) Read(p []byte) (int, error) {
	if r.sent {
		return 0, io.ErrUnexpectedEOF
	}
	r.sent = true
	return copy(p, "gost_services 1\ngost_service_transfer_input_bytes_total 200\n"), nil
}
func TestForwardCollector(t *testing.T) {
	large, status, restart := false, 200, false
	var manifestPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/metrics" {
			t.Error("unexpected path")
		}
		if restart {
			os.WriteFile(manifestPath, []byte(`{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","epoch":"cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa","port":1234}`), 0600)
		}
		w.WriteHeader(status)
		if large {
			w.Write([]byte(strings.Repeat("# padding\n", 30000)))
		}
		w.Write([]byte("gost_services 1\ngost_service_transfer_input_bytes_total 42\ngost_service_transfer_output_bytes_total 84\n"))
	}))
	defer server.Close()
	port, _ := strconv.Atoi(strings.TrimPrefix(server.URL, "http://127.0.0.1:"))
	dir := t.TempDir()
	raw, _ := json.Marshal(forwardManifest{ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", Epoch: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff", Port: port})
	manifestPath = filepath.Join(dir, "rule.json")
	os.WriteFile(manifestPath, raw, 0600)
	os.WriteFile(filepath.Join(dir, "invalid.json"), []byte(`{"id":"bad","port":80}`), 0600)
	samples := collectForwarding(context.Background(), dir)
	if len(samples) != 1 || !samples[0].Available || samples[0].Rx != 42 || samples[0].Tx != 84 {
		t.Fatalf("bad samples: %+v", samples)
	}
	large = true
	samples = collectForwarding(context.Background(), dir)
	if !samples[0].Available || samples[0].Tx != 84 {
		t.Fatalf("large response lost: %+v", samples)
	}
	status = 503
	samples = collectForwarding(context.Background(), dir)
	if samples[0].Available || samples[0].Error != "metrics_http_error" {
		t.Fatalf("HTTP failure: %+v", samples)
	}
	status = 200
	restart = true
	samples = collectForwarding(context.Background(), dir)
	if samples[0].Available || samples[0].Error != "metrics_process_changed" || samples[0].Rx != 0 {
		t.Fatalf("restart race: %+v", samples)
	}
}

func TestSharedCollectorReadsOnceAndSeparatesServices(t *testing.T) {
	ids := []string{"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"}
	generation := "cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa"
	names := []string{"ff-" + ids[0] + "-" + generation + "-tcp", "ff-" + ids[1] + "-" + generation + "-udp"}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		fmt.Fprintf(w, "gost_services 2\ngost_service_transfer_input_bytes_total{service=%q,client=\"with space\"} 100\ngost_service_transfer_output_bytes_total{service=%q} 200\ngost_service_transfer_input_bytes_total{service=%q} 300\ngost_service_transfer_output_bytes_total{service=%q} 400\ngost_service_transfer_output_bytes_total{service=\"unrelated\"} 9000\n", names[0], names[0], names[1], names[1])
	}))
	defer server.Close()
	port, _ := strconv.Atoi(strings.TrimPrefix(server.URL, "http://127.0.0.1:"))
	dir := t.TempDir()
	for i, id := range ids {
		raw, _ := json.Marshal(forwardManifest{ID: id, Epoch: generation, Port: port, Format: 2, Services: []string{names[i]}})
		os.WriteFile(filepath.Join(dir, id+".json"), raw, 0600)
	}
	samples := collectForwarding(context.Background(), dir)
	if requests.Load() != 1 || len(samples) != 2 {
		t.Fatalf("requests=%d samples=%+v", requests.Load(), samples)
	}
	for _, s := range samples {
		if !s.Available {
			t.Fatal(s)
		}
		if s.ID == ids[0] && (s.Rx != 100 || s.Tx != 200) || s.ID == ids[1] && (s.Rx != 300 || s.Tx != 400) {
			t.Fatalf("mixed counters: %+v", samples)
		}
	}
	// Names may not point at another rule, even when an endpoint is shared.
	raw, _ := json.Marshal(forwardManifest{ID: ids[0], Epoch: generation, Port: port, Format: 2, Services: []string{names[1]}})
	os.WriteFile(filepath.Join(dir, ids[0]+".json"), raw, 0600)
	if got := collectForwarding(context.Background(), dir); len(got) != 1 || got[0].ID != ids[1] {
		t.Fatalf("invalid mapping accepted: %+v", got)
	}
}

func TestForwardLargeSharedStream(t *testing.T) {
	id := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	service := "ff-" + id + "-cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa-tcp"
	line := fmt.Sprintf("gost_service_transfer_output_bytes_total{host=\"node\",service=%q,client=\"192.0.2.10\"} 100\n", service)
	const lines = 100000
	raw := "gost_services 1\n" + strings.Repeat(line, lines)
	if len(raw) <= 16*1024*1024 {
		t.Fatal("fixture must exceed the previous response cap")
	}
	counts := map[string]*forwardCount{service: {}}
	rx, tx, _, err := readForwardMetrics(strings.NewReader(raw), counts)
	if err != nil || rx != 0 || tx != lines*100 || counts[service].Tx != lines*100 {
		t.Fatalf("large stream dropped or mixed: %d %d %v %+v", rx, tx, err, counts)
	}
	if _, _, _, err = readForwardMetrics(strings.NewReader(raw + "gost_service_transfer_output_bytes_total NaN\n")); err == nil {
		t.Fatal("accepted partial result before invalid tail")
	}
}

func TestForwardSlowBodyAndErrorReasons(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		time.Sleep(2200 * time.Millisecond)
		fmt.Fprint(w, "gost_services 1\ngost_service_transfer_output_bytes_total 321\n")
	}))
	defer server.Close()
	port, _ := strconv.Atoi(strings.TrimPrefix(server.URL, "http://127.0.0.1:"))
	dir := t.TempDir()
	raw, _ := json.Marshal(forwardManifest{ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", Epoch: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff", Port: port})
	os.WriteFile(filepath.Join(dir, "rule.json"), raw, 0600)
	got := collectForwarding(context.Background(), dir)
	if len(got) != 1 || !got[0].Available || got[0].Tx != 321 {
		t.Fatalf("response slower than old two-second deadline lost: %+v", got)
	}
	_, _, _, err := readForwardMetrics(strings.NewReader("gost_services 1\n" + strings.Repeat("x", 65536)))
	if err == nil || err.Error() != "metrics_line_too_long" {
		t.Fatalf("line error: %v", err)
	}
	_, _, _, err = readForwardMetrics(&brokenMetricsReader{})
	if err == nil || err.Error() != "metrics_read_failed" {
		t.Fatalf("truncated error: %v", err)
	}
	if forwardReadError(context.DeadlineExceeded) != "metrics_timeout" {
		t.Fatal("timeout not identified")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	got = collectForwarding(ctx, dir)
	if len(got) != 1 || got[0].Available || got[0].Error != "metrics_timeout" {
		t.Fatalf("deadline produced partial success: %+v", got)
	}
}

func TestForwardServiceLabelBoundaries(t *testing.T) {
	for _, row := range []struct{ raw, want string }{
		{`{client="text,service=\"wrong\"", service="correct",host="x"}`, "correct"},
		{`{service="escaped\"name",host="x"}`, `escaped"name`},
		{`{client="only"}`, ""},
	} {
		if got := forwardServiceValue(row.raw); got != row.want {
			t.Fatalf("%s => %q", row.raw, got)
		}
	}
	for _, row := range []string{"gost_services 1 3 4", "gost_services 1 ++3", "gost_services 1 -+3", "gost_services 1 bad"} {
		if _, _, _, err := readForwardMetrics(strings.NewReader(row)); err == nil {
			t.Fatalf("invalid suffix accepted: %q", row)
		}
	}
}

func TestForwardPollerDoesNotBlockOrOverlap(t *testing.T) {
	started, release := make(chan struct{}, 2), make(chan struct{})
	p := newForwardPoller(func(ctx context.Context) []ForwardSample {
		started <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
		}
		return []ForwardSample{{ID: "fixture", Available: true, Tx: 123}}
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if p.latest(ctx) != nil {
		t.Fatal("first sample should wait asynchronously")
	}
	<-started
	for i := 0; i < 20; i++ {
		p.latest(ctx)
	}
	select {
	case <-started:
		t.Fatal("overlapping collection")
	default:
	}
	close(release)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if samples := p.latest(ctx); len(samples) == 1 {
			if samples[0].Tx != 123 {
				t.Fatal(samples)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("completed sample not published")
}

func BenchmarkForwardLargeSharedStream(b *testing.B) {
	service := "ff-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa-tcp"
	line := fmt.Sprintf("gost_service_transfer_output_bytes_total{service=%q,client=\"192.0.2.1\"} 100\n", service)
	raw := "gost_services 1\n" + strings.Repeat(line, 90000)
	b.SetBytes(int64(len(raw)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		counts := map[string]*forwardCount{service: {}}
		if _, _, _, err := readForwardMetrics(strings.NewReader(raw), counts); err != nil {
			b.Fatal(err)
		}
	}
}
