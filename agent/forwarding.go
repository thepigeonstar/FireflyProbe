package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ForwardSample struct {
	ID        string `json:"id"`
	Epoch     string `json:"epoch"`
	Sampled   int64  `json:"sampled"`
	Available bool   `json:"available"`
	Rx        uint64 `json:"rx"`
	Tx        uint64 `json:"tx"`
	Errors    uint64 `json:"errors"`
	Error     string `json:"error,omitempty"`
}
type forwardManifest struct {
	ID       string   `json:"id"`
	Epoch    string   `json:"epoch"`
	Port     int      `json:"port"`
	Format   int      `json:"format,omitempty"`
	Services []string `json:"services,omitempty"`
}

type forwardCount struct{ Rx, Tx, Errors float64 }
type forwardItem struct {
	path     string
	raw      []byte
	manifest forwardManifest
}

// Only the reporting loop accesses this state; the worker returns through a
// bounded channel. Slow Metrics collection must not delay basic host reports.
type forwardPoller struct {
	result  chan []ForwardSample
	collect func(context.Context) []ForwardSample
	started time.Time
	running bool
	cached  []ForwardSample
}

func newForwardPoller(collect func(context.Context) []ForwardSample) *forwardPoller {
	return &forwardPoller{result: make(chan []ForwardSample, 1), collect: collect}
}

func (p *forwardPoller) latest(ctx context.Context) []ForwardSample {
	select {
	case p.cached = <-p.result:
		p.running = false
	default:
	}
	if ctx.Err() == nil && !p.running && (p.started.IsZero() || time.Since(p.started) >= 30*time.Second) {
		p.running = true
		p.started = time.Now()
		go func() {
			samples := p.collect(ctx)
			select {
			case p.result <- samples:
			case <-ctx.Done():
			}
		}()
	}
	return p.cached
}

var forwardID = regexp.MustCompile(`^[a-f0-9-]{36}$`)
var forwardServiceName = regexp.MustCompile(`^ff-[a-f0-9-]{36}-[a-f0-9-]{36}-(tcp|udp)$`)

const forwardMetricsLimit = 64 * 1024 * 1024

// Parse the metric envelope without running a whole-line regular expression on
// every client series. Label values may contain spaces and escaped quotes.
func forwardMetricParts(line string) (name, labels, value string, tracked, valid bool) {
	i := strings.IndexAny(line, "{ \t")
	if i < 0 {
		i = len(line)
	}
	name = line[:i]
	switch name {
	case "gost_services", "gost_service_transfer_input_bytes_total", "gost_service_transfer_output_bytes_total", "gost_service_handler_errors_total":
	default:
		return "", "", "", false, true
	}
	rest := line[i:]
	if strings.HasPrefix(rest, "{") {
		end := strings.LastIndexByte(rest, '}')
		if end < 0 {
			return name, "", "", true, false
		}
		labels, rest = rest[:end+1], rest[end+1:]
	}
	if len(rest) == 0 || rest[0] != ' ' && rest[0] != '\t' {
		return name, labels, "", true, false
	}
	tail := strings.TrimSpace(rest)
	if tail == "" {
		return name, labels, "", true, false
	}
	value = tail
	if end := strings.IndexAny(tail, " \t"); end >= 0 {
		value = tail[:end]
		field := strings.TrimSpace(tail[end:])
		stamp := strings.TrimLeft(field, "+-")
		if stamp == "" || len(field)-len(stamp) > 1 {
			return name, labels, "", true, false
		}
		for _, c := range stamp {
			if c < '0' || c > '9' {
				return name, labels, "", true, false
			}
		}
	}
	return name, labels, value, true, true
}

func forwardServiceValue(labels string) string {
	// Walk quoted fields so text inside another label cannot become a service.
	for i := 1; i < len(labels)-1; {
		for i < len(labels)-1 && (labels[i] == ' ' || labels[i] == '\t' || labels[i] == ',') {
			i++
		}
		keyStart := i
		for i < len(labels)-1 && labels[i] != '=' {
			i++
		}
		if i >= len(labels)-1 {
			return ""
		}
		key := strings.TrimSpace(labels[keyStart:i])
		i++
		if i >= len(labels)-1 || labels[i] != '"' {
			return ""
		}
		i++
		start := i
		for i < len(labels)-1 {
			if labels[i] == '\\' {
				i += 2
				continue
			}
			if labels[i] == '"' {
				break
			}
			i++
		}
		if i >= len(labels)-1 {
			return ""
		}
		raw := labels[start:i]
		i++
		if key == "service" {
			if strings.Contains(raw, "\\") {
				decoded, err := strconv.Unquote("\"" + raw + "\"")
				if err != nil {
					return ""
				}
				return decoded
			}
			return raw
		}
		if i < len(labels)-1 && labels[i] != ',' && labels[i] != ' ' && labels[i] != '\t' {
			return ""
		}
	}
	return ""
}

func forwardReadError(err error) string {
	if errors.Is(err, bufio.ErrTooLong) {
		return "metrics_line_too_long"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "metrics_timeout"
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return "metrics_timeout"
	}
	return "metrics_read_failed"
}

// Stream the response: client labels can grow well beyond 256 KiB. Never
// accept a partial response as a smaller counter or hold it all in memory.
func readForwardMetrics(reader io.Reader, split ...map[string]*forwardCount) (uint64, uint64, uint64, error) {
	limited := &io.LimitedReader{R: reader, N: forwardMetricsLimit + 1}
	scanner := bufio.NewScanner(limited)
	scanner.Buffer(make([]byte, 4096), 65536)
	var rx, tx, failures float64
	marker := false
	for scanner.Scan() {
		line := scanner.Text()
		name, labels, raw, tracked, valid := forwardMetricParts(line)
		if !tracked {
			continue
		}
		if !valid {
			return 0, 0, 0, errors.New("metrics_invalid")
		}
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || value < 0 || math.IsNaN(value) || math.IsInf(value, 0) || value > 8e15 {
			return 0, 0, 0, errors.New("metrics_invalid")
		}
		switch name {
		case "gost_services":
			marker = true
		case "gost_service_transfer_input_bytes_total":
			rx += value
		case "gost_service_transfer_output_bytes_total":
			tx += value
		case "gost_service_handler_errors_total":
			failures += value
		}
		if len(split) > 0 {
			serviceName := forwardServiceValue(labels)
			if counter := split[0][serviceName]; counter != nil {
				switch name {
				case "gost_service_transfer_input_bytes_total":
					counter.Rx += value
				case "gost_service_transfer_output_bytes_total":
					counter.Tx += value
				case "gost_service_handler_errors_total":
					counter.Errors += value
				}
			}
		}
	}
	if limited.N <= 0 {
		return 0, 0, 0, errors.New("metrics_too_large")
	}
	if scanner.Err() != nil {
		return 0, 0, 0, errors.New(forwardReadError(scanner.Err()))
	}
	if !marker {
		return 0, 0, 0, errors.New("metrics_marker_missing")
	}
	if rx > 8e15 || tx > 8e15 || failures > 8e15 {
		return 0, 0, 0, errors.New("metrics_invalid")
	}
	return uint64(rx), uint64(tx), uint64(failures), nil
}

func collectForwarding(parent context.Context, directory string) []ForwardSample {
	paths, _ := filepath.Glob(filepath.Join(directory, "*.json"))
	if len(paths) > 200 {
		paths = paths[:200]
	}
	if len(paths) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 12 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	groups := map[int][]forwardItem{}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil || len(raw) > 4096 {
			continue
		}
		var m forwardManifest
		if json.Unmarshal(raw, &m) != nil || !forwardID.MatchString(m.ID) || !forwardID.MatchString(m.Epoch) || m.Port < 1 || m.Port > 65535 {
			continue
		}
		if m.Format != 0 && m.Format != 2 {
			continue
		}
		if m.Format == 2 {
			if len(m.Services) < 1 || len(m.Services) > 2 {
				continue
			}
			valid := true
			for _, name := range m.Services {
				if !forwardServiceName.MatchString(name) || !strings.HasPrefix(name, "ff-"+m.ID+"-") {
					valid = false
				}
			}
			if !valid {
				continue
			}
		} else if len(m.Services) > 0 {
			continue
		}
		groups[m.Port] = append(groups[m.Port], forwardItem{path, raw, m})
	}
	queue := make(chan []forwardItem, len(groups))
	for _, group := range groups {
		queue <- group
	}
	close(queue)
	var mu sync.Mutex
	samples := []ForwardSample{}
	var wg sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for group := range queue {
				counts := map[string]*forwardCount{}
				for _, item := range group {
					for _, name := range item.manifest.Services {
						counts[name] = &forwardCount{}
					}
				}
				sample := ForwardSample{Sampled: time.Now().Unix(), Error: "metrics_unreachable"}
				req, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:"+strconv.Itoa(group[0].manifest.Port)+"/metrics", nil)
				if response, e := client.Do(req); e == nil {
					if response.StatusCode == 200 {
						rx, tx, failures, err := readForwardMetrics(response.Body, counts)
						if err != nil {
							sample.Error = err.Error()
						} else {
							sample.Available, sample.Error = true, ""
							sample.Rx, sample.Tx, sample.Errors = rx, tx, failures
						}
					} else {
						sample.Error = "metrics_http_error"
					}
					response.Body.Close()
				} else if forwardReadError(e) == "metrics_timeout" {
					sample.Error = "metrics_timeout"
				}
				for _, item := range group {
					value := sample
					value.ID, value.Epoch = item.manifest.ID, item.manifest.Epoch
					if value.Available && item.manifest.Format == 2 {
						var rx, tx, failures float64
						for _, name := range item.manifest.Services {
							c := counts[name]
							rx += c.Rx
							tx += c.Tx
							failures += c.Errors
						}
						value.Rx, value.Tx, value.Errors = uint64(rx), uint64(tx), uint64(failures)
					}
					// Re-read each mapping: a live API edit can change one service only.
					afterRaw, err := os.ReadFile(item.path)
					if err != nil || !bytes.Equal(afterRaw, item.raw) {
						value.Available, value.Error = false, "metrics_process_changed"
						value.Rx, value.Tx, value.Errors = 0, 0, 0
					}
					mu.Lock()
					samples = append(samples, value)
					mu.Unlock()
				}
			}
		}()
	}
	wg.Wait()
	return samples
}
