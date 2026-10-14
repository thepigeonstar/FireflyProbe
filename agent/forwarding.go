package main

import (
	"context"
	"encoding/json"
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
}
type forwardManifest struct {
	ID    string `json:"id"`
	Epoch string `json:"epoch"`
	Port  int    `json:"port"`
}

var forwardID = regexp.MustCompile(`^[a-f0-9-]{36}$`)

func parseForwardMetrics(raw string) (uint64, uint64, uint64) {
	var rx, tx, errors float64
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		key := strings.SplitN(fields[0], "{", 2)[0]
		value, e := strconv.ParseFloat(fields[1], 64)
		if e != nil || value < 0 || math.IsNaN(value) || math.IsInf(value, 0) || value > 8e15 {
			continue
		}
		switch key {
		case "gost_service_transfer_input_bytes_total":
			rx += value
		case "gost_service_transfer_output_bytes_total":
			tx += value
		case "gost_service_handler_errors_total":
			errors += value
		}
	}
	return uint64(math.Min(rx, 8e15)), uint64(math.Min(tx, 8e15)), uint64(math.Min(errors, 8e15))
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
				sample := ForwardSample{ID: manifest.ID, Epoch: manifest.Epoch, Sampled: time.Now().Unix()}
				req, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:"+strconv.Itoa(manifest.Port)+"/metrics", nil)
				if response, e := client.Do(req); e == nil {
					body, e := io.ReadAll(io.LimitReader(response.Body, 262145))
					response.Body.Close()
					if e == nil && response.StatusCode == 200 && len(body) <= 262144 && strings.Contains(string(body), "gost_services") {
						sample.Available = true
						sample.Rx, sample.Tx, sample.Errors = parseForwardMetrics(string(body))
					}
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
