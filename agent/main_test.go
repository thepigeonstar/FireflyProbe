package main

import "testing"

func TestCountersReset(t *testing.T) {
	if rate(1000, 50, 5) != 0 {
		t.Fatal("counter reset must not produce spike")
	}
	if rate(10, 1010, 5) != 200 {
		t.Fatal("wrong bytes/sec")
	}
	if cpuPercent(CPUCounter{100, 50}, CPUCounter{200, 75}) != 75 {
		t.Fatal("wrong CPU percent")
	}
}
func TestCPUExcludesGuest(t *testing.T) {
	c, e := parseCPU("cpu 10 20 30 40 5 6 7 8 100 200\n")
	if e != nil || c.Total != 126 || c.Idle != 45 {
		t.Fatalf("%+v %v", c, e)
	}
}
func TestMemoryAndNetwork(t *testing.T) {
	total, used, e := parseMemory("MemTotal: 100 kB\nMemAvailable: 40 kB\n")
	if e != nil || total != 102400 || used != 61440 {
		t.Fatal("memory parse")
	}
	n := parseNetwork("eth0: 10 0 0 0 0 0 0 0 20 0 0 0 0 0 0 0\n")
	if n["eth0"].Rx != 10 || n["eth0"].Tx != 20 {
		t.Fatal("network parse")
	}
}
func TestVnstatDays(t *testing.T) {
	raw := []byte(`{"interfaces":[{"name":"eth0","traffic":{"day":[{"date":{"year":2026,"month":10,"day":10},"rx":100,"tx":200},{"date":{"year":2026,"month":10,"day":11},"rx":300,"tx":400}]}}]}`)
	days, e := parseDays(raw, "eth0", 180, "2026-10-11")
	if e != nil || len(days) != 1 || days[0].Rx != 300 {
		t.Fatalf("%v %v", days, e)
	}
	if _, e = parseDays(raw, "ens3", 180, ""); e == nil {
		t.Fatal("must reject incorrect interface")
	}
}
