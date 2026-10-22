package main

import (
	"bufio"
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
	ID    string `json:"id"`
	Epoch string `json:"epoch"`
	Port  int    `json:"port"`
}

var forwardID = regexp.MustCompile(`^[a-f0-9-]{36}$`)
var forwardMetricLine = regexp.MustCompile(`^(gost_services|gost_service_transfer_input_bytes_total|gost_service_transfer_output_bytes_total|gost_service_handler_errors_total)(?:\{.*\})?[ \t]+(\S+)(?:[ \t]+[+-]?\d+)?$`)

const forwardMetricsLimit = 16 * 1024 * 1024

// Stream the response: client labels can grow well beyond 256 KiB. Never
// accept a partial response as a smaller counter or hold it all in memory.
func readForwardMetrics(reader io.Reader) (uint64, uint64, uint64, error) {
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
	queue := make(chan string, len(paths))
	for _, path := range paths {
		queue <- path
	}
	close(queue)
	var mu sync.Mutex
	samples := []ForwardSample{}
	var wg sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for path := range queue {
				raw, e := os.ReadFile(path)
				if e != nil || len(raw) > 4096 {
					continue
				}
				var manifest forwardManifest
				if json.Unmarshal(raw, &manifest) != nil || !forwardID.MatchString(manifest.ID) || !forwardID.MatchString(manifest.Epoch) || manifest.Port < 1 || manifest.Port > 65535 {
					continue
				}
				sample := ForwardSample{ID: manifest.ID, Epoch: manifest.Epoch, Sampled: time.Now().Unix(), Error: "metrics_unreachable"}
				req, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:"+strconv.Itoa(manifest.Port)+"/metrics", nil)
				if response, e := client.Do(req); e == nil {
					if response.StatusCode == 200 {
						rx, tx, failures, err := readForwardMetrics(response.Body)
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
				// A restart can replace the manifest while HTTP is being read.
				afterRaw, err := os.ReadFile(path)
				var after forwardManifest
				if err != nil || json.Unmarshal(afterRaw, &after) != nil || after != manifest {
					sample.Available, sample.Error = false, "metrics_process_changed"
					sample.Rx, sample.Tx, sample.Errors = 0, 0, 0
				}
				mu.Lock()
				samples = append(samples, sample)
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return samples
}
