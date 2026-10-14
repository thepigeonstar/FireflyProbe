package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestForwardMetrics(t *testing.T) {
	rx, tx, errors := parseForwardMetrics("gost_service_transfer_input_bytes_total{service=\"service-0\"} 100\ngost_service_transfer_input_bytes_total{service=\"service-1\"} 200\ngost_service_transfer_output_bytes_total 4e2\ngost_service_handler_errors_total 2\ngost_service_transfer_output_bytes_total NaN\ngost_service_transfer_input_bytes_total -1\n")
	if rx != 300 || tx != 400 || errors != 2 {
		t.Fatalf("%d %d %d", rx, tx, errors)
	}
}
func TestForwardCollector(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/metrics" {
			t.Error("unexpected path")
		}
		w.Write([]byte("gost_services 1\ngost_service_transfer_input_bytes_total 42\ngost_service_transfer_output_bytes_total 84\n"))
	}))
	defer server.Close()
	port, _ := strconv.Atoi(strings.TrimPrefix(server.URL, "http://127.0.0.1:"))
	dir := t.TempDir()
	raw, _ := json.Marshal(forwardManifest{ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", Epoch: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff", Port: port})
	os.WriteFile(filepath.Join(dir, "rule.json"), raw, 0600)
	os.WriteFile(filepath.Join(dir, "invalid.json"), []byte(`{"id":"bad","port":80}`), 0600)
	samples := collectForwarding(context.Background(), dir)
	if len(samples) != 1 || !samples[0].Available || samples[0].Rx != 42 || samples[0].Tx != 84 {
		t.Fatalf("bad samples: %+v", samples)
	}
}
