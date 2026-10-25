package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
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

var forwardID = regexp.MustCompile(`^[a-f0-9-]{36}$`)
var forwardMetricLine = regexp.MustCompile(`^(gost_services|gost_service_transfer_input_bytes_total|gost_service_transfer_output_bytes_total|gost_service_handler_errors_total)(?:\{.*\})?[ \t]+(\S+)(?:[ \t]+[+-]?\d+)?$`)
var forwardServiceLabel = regexp.MustCompile(`(?:\{|,)\s*service="((?:\\.|[^"\\])*)"(?:,|\})`)
var forwardServiceName = regexp.MustCompile(`^ff-[a-f0-9-]{36}-[a-f0-9-]{36}-(tcp|udp)$`)

const forwardMetricsLimit = 16 * 1024 * 1024

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
		match := forwardMetricLine.FindStringSubmatch(line)
		if match == nil {
			for _, name := range []string{"gost_services", "gost_service_transfer_input_bytes_total", "gost_service_transfer_output_bytes_total", "gost_service_handler_errors_total"} {
				if line == name || strings.HasPrefix(line, name+"{") || strings.HasPrefix(line, name+" ") || strings.HasPrefix(line, name+"\t") {
					return 0, 0, 0, errors.New("metrics_invalid")
				}
			}
			continue
		}
		value, err := strconv.ParseFloat(match[2], 64)
		if err != nil || value < 0 || math.IsNaN(value) || math.IsInf(value, 0) || value > 8e15 {
			return 0, 0, 0, errors.New("metrics_invalid")
		}
		switch match[1] {
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
			label := forwardServiceLabel.FindStringSubmatch(line)
			if len(label) == 2 {
				name, err := strconv.Unquote(`"` + label[1] + `"`)
				if counter := split[0][name]; err == nil && counter != nil {
					switch match[1] {
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
	}
	if limited.N <= 0 {
		return 0, 0, 0, errors.New("metrics_too_large")
	}
	if scanner.Err() != nil {
		return 0, 0, 0, errors.New("metrics_read_failed")
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
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
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
