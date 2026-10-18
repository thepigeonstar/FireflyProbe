package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFireflyProbeRequestIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != "FireflyProbe/"+version {
			t.Error("agent must identify itself as FireflyProbe")
		}
		if r.Header.Get("Authorization") != "Bearer fixture-token" {
			t.Error("node identity must be preserved")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	if err := request(context.Background(), server.Client(), Config{Server: server.URL, Token: "fixture-token"}, "/api/agent/config", nil, nil); err != nil {
		t.Fatal(err)
	}
}
