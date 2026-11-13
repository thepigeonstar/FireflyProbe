package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFirstDayPersistentDeltasAndShanghaiDay(t *testing.T) {
	cfg := Config{Server: "https://probe.example", Token: "private-token"}
	at := time.Date(2026, 11, 13, 17, 0, 0, 0, time.UTC)
	s := firstDayState{Identity: firstDayIdentity(cfg), Date: "2026-11-14", Interface: "ens5", Timezone: "Asia/Shanghai", Boot: "boot-a", LastRx: 1000, LastTx: 2000, Rx: 100, Tx: 200}
	path := filepath.Join(t.TempDir(), "first-day.json")
	raw, _ := json.Marshal(s)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	day, err := collectFirstDay(path, cfg, "ens5", "Asia/Shanghai", "boot-a", at, Counters{1100, 2400})
	if err != nil || day.Date != "2026-11-14" || day.Rx != 200 || day.Tx != 600 {
		t.Fatalf("%+v %v", day, err)
	}
	day, err = collectFirstDay(path, cfg, "ens5", "Asia/Shanghai", "boot-a", at, Counters{1100, 2400})
	if err != nil || day.Rx != 200 || day.Tx != 600 {
		t.Fatal("repeated sample duplicated", day, err)
	}
	day, err = collectFirstDay(path, cfg, "ens5", "Asia/Shanghai", "boot-a", at, Counters{1200, 2500})
	if err != nil || day.Rx != 300 || day.Tx != 700 {
		t.Fatal("restart did not preserve baseline", day, err)
	}
	day, err = collectFirstDay(path, cfg, "ens5", "Asia/Shanghai", "boot-b", at, Counters{10, 20})
	if err != nil || day.Rx != 310 || day.Tx != 720 {
		t.Fatal("reboot reset invalid", day, err)
	}
	day, err = collectFirstDay(path, cfg, "ens5", "Asia/Shanghai", "boot-b", at.Add(24*time.Hour), Counters{200, 300})
	if err != nil || day != nil {
		t.Fatal("expired day mixed into next day", day, err)
	}
}
func TestFirstDayRejectsIdentityAndOverflow(t *testing.T) {
	cfg := Config{Server: "https://probe.example", Token: "private-token"}
	at := time.Date(2026, 11, 13, 0, 0, 0, 0, time.UTC)
	base := firstDayState{Identity: firstDayIdentity(cfg), Date: "2026-11-13", Interface: "ens5", Timezone: "Asia/Shanghai", Boot: "a", LastRx: 100, LastTx: 100}
	for _, test := range []struct {
		name   string
		mutate func(*firstDayState)
	}{{"identity", func(s *firstDayState) { s.Identity = "old-node" }}, {"iface", func(s *firstDayState) { s.Interface = "eth0" }}, {"timezone", func(s *firstDayState) { s.Timezone = "UTC" }}, {"overflow", func(s *firstDayState) { s.Rx = 8e15 }}} {
		t.Run(test.name, func(t *testing.T) {
			s := base
			test.mutate(&s)
			if _, err := advanceFirstDay(&s, cfg, "ens5", "Asia/Shanghai", "a", at, Counters{200, 200}); err == nil {
				t.Fatal("invalid checkpoint accepted")
			}
		})
	}
	s := base
	day, err := advanceFirstDay(&s, cfg, "ens5", "Asia/Shanghai", "a", at, Counters{10, 20})
	if err != nil || day.Rx != 10 || day.Tx != 20 {
		t.Fatal("interface reset must not spike", day, err)
	}
	if _, err = advanceFirstDay(&s, cfg, "ens5", "Asia/Shanghai", "", at, Counters{20, 30}); err == nil {
		t.Fatal("missing boot ID accepted")
	}
}
