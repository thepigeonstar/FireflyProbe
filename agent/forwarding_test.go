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
	"testing"
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
