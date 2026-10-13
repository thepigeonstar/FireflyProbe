package main

import (
	"encoding/json"
	"net/http"
	"os"
)

func main() {
	file := os.Args[1]
	http.HandleFunc("/api/agent/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"interface":"eth0","interval":3,"timezone":"Asia/Shanghai","history_days":180}`))
	})
	http.HandleFunc("/api/agent/report", func(w http.ResponseWriter, r *http.Request) {
		var value map[string]any
		if json.NewDecoder(r.Body).Decode(&value) != nil || value["interface"] != "eth0" {
			http.Error(w, "invalid report", 400)
			return
		}
		data, _ := json.Marshal(value)
		_ = os.WriteFile(file, data, 0600)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	if http.ListenAndServe("127.0.0.1:18080", nil) != nil {
		os.Exit(1)
	}
}
