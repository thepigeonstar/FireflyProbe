package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const version = "0.2.2"

type Config struct {
	Server         string `json:"server"`
	Token          string `json:"token"`
	DiskPath       string `json:"disk_path"`
	HistoryStart   string `json:"history_start"`
	VnstatTimezone string `json:"vnstat_timezone"`
}
type Remote struct {
	Interface   string `json:"interface"`
	Interval    int    `json:"interval"`
	Timezone    string `json:"timezone"`
	HistoryDays int    `json:"history_days"`
}
type Day struct {
	Date string `json:"date"`
	Rx   uint64 `json:"rx"`
	Tx   uint64 `json:"tx"`
}
type Report struct {
	Version         string          `json:"version"`
	Hostname        string          `json:"hostname"`
	System          string          `json:"system"`
	Forwarding      []ForwardSample `json:"forwarding,omitempty"`
	Interface       string          `json:"interface"`
	Interfaces      []string        `json:"interfaces"`
	RxSpeed         float64         `json:"rx_speed"`
	TxSpeed         float64         `json:"tx_speed"`
	CPU             float64         `json:"cpu"`
	MemTotal        uint64          `json:"mem_total"`
	MemUsed         uint64          `json:"mem_used"`
	DiskTotal       uint64          `json:"disk_total"`
	DiskUsed        uint64          `json:"disk_used"`
	Uptime          float64         `json:"uptime"`
	SampleError     string          `json:"sample_error"`
	Days            *[]Day          `json:"days,omitempty"`
	HistoryError    string          `json:"history_error,omitempty"`
	HistoryTimezone string          `json:"history_timezone,omitempty"`
}
type Counters struct{ Rx, Tx uint64 }

// Read release metadata as data; never execute shell assignments.
func parseSystem(raw string) string {
	values := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		if key != "PRETTY_NAME" && key != "NAME" && key != "VERSION_ID" {
			continue
		}
		value = strings.TrimSpace(value)
		if strings.HasPrefix(value, "\"") {
			if decoded, err := strconv.Unquote(value); err == nil {
				value = decoded
			}
		} else {
			value = strings.Trim(value, "'")
		}
		values[key] = value
	}
	result := values["PRETTY_NAME"]
	if result == "" {
		result = strings.TrimSpace(values["NAME"] + " " + values["VERSION_ID"])
	}
	result = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, result)
	runes := []rune(result)
	if len(runes) > 120 {
		result = string(runes[:120])
	}
	return result
}

func readSystem() string {
	for _, path := range []string{"/etc/os-release", "/usr/lib/os-release"} {
		if raw, err := os.ReadFile(path); err == nil {
			if name := parseSystem(string(raw)); name != "" {
				return name
			}
		}
	}
	return "Linux"
}

type CPUCounter struct{ Total, Idle uint64 }

var interfacePattern = regexp.MustCompile(`^[a-zA-Z0-9_.:@-]{1,40}$`)
var zonePattern = regexp.MustCompile(`^[A-Za-z0-9_+/-]{1,80}$`)

func parseNetwork(raw string) map[string]Counters {
	result := map[string]Counters{}
	for _, line := range strings.Split(raw, "\n") {
		left, right, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		name := strings.TrimSpace(left)
		fields := strings.Fields(right)
		if len(fields) < 16 {
			continue
		}
		rx, e1 := strconv.ParseUint(fields[0], 10, 64)
		tx, e2 := strconv.ParseUint(fields[8], 10, 64)
		if e1 == nil && e2 == nil {
			result[name] = Counters{rx, tx}
		}
	}
	return result
}
func parseCPU(raw string) (CPUCounter, error) {
	lines := strings.Split(raw, "\n")
	if len(lines) == 0 {
		return CPUCounter{}, errors.New("CPU stats missing")
	}
	fields := strings.Fields(lines[0])
	if len(fields) < 5 || fields[0] != "cpu" {
		return CPUCounter{}, errors.New("CPU stats invalid")
	}
	var c CPUCounter
	// guest and guest_nice are already included in user/nice; do not count twice.
	for i := 1; i < len(fields) && i <= 8; i++ {
		v, e := strconv.ParseUint(fields[i], 10, 64)
		if e != nil {
			return c, e
		}
		c.Total += v
		if i == 4 || i == 5 {
			c.Idle += v
		}
	}
	return c, nil
}
func cpuPercent(previous, current CPUCounter) float64 {
	if current.Total <= previous.Total || current.Idle < previous.Idle {
		return 0
	}
	total := current.Total - previous.Total
	idle := current.Idle - previous.Idle
	if idle > total {
		return 0
	}
	return float64(total-idle) * 100 / float64(total)
}
func rate(previous, current uint64, seconds float64) float64 {
	if seconds <= 0 || current < previous {
		return 0
	}
	return float64(current-previous) / seconds
}
func parseMemory(raw string) (uint64, uint64, error) {
	values := map[string]uint64{}
	for _, line := range strings.Split(raw, "\n") {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		v, e := strconv.ParseUint(f[1], 10, 64)
		if e == nil {
			values[strings.TrimSuffix(f[0], ":")] = v * 1024
		}
	}
	total := values["MemTotal"]
	available, ok := values["MemAvailable"]
	if !ok {
		available = values["MemFree"] + values["Buffers"] + values["Cached"]
	}
	if total == 0 {
		return 0, 0, errors.New("memory stats missing")
	}
	if available > total {
		available = total
	}
	return total, total - available, nil
}
func detectInterface(counters map[string]Counters) (string, error) {
	// Prefer the IPv4 default route, then an IPv6 default route.
	data, _ := os.ReadFile("/proc/net/route")
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Fields(line)
		if len(f) >= 4 && f[1] == "00000000" {
			if _, ok := counters[f[0]]; ok {
				return f[0], nil
			}
		}
	}
	data, _ = os.ReadFile("/proc/net/ipv6_route")
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Fields(line)
		if len(f) >= 10 && f[0] == strings.Repeat("0", 32) && f[1] == "00" {
			name := f[len(f)-1]
			if _, ok := counters[name]; ok && name != "lo" {
				return name, nil
			}
		}
	}
	return "", errors.New("no default-route interface; set interface in dashboard")
}
func parseDays(data []byte, iface string, limit int, start string) ([]Day, error) {
	var doc struct {
		Interfaces []struct {
			Name    string `json:"name"`
			Traffic struct {
				Day []struct {
					Date struct {
						Year  int `json:"year"`
						Month int `json:"month"`
						Day   int `json:"day"`
					} `json:"date"`
					Rx uint64 `json:"rx"`
					Tx uint64 `json:"tx"`
				} `json:"day"`
			} `json:"traffic"`
		} `json:"interfaces"`
	}
	if e := json.Unmarshal(data, &doc); e != nil {
		return nil, e
	}
	for _, item := range doc.Interfaces {
		if item.Name != iface {
			continue
		}
		out := []Day{}
		for _, d := range item.Traffic.Day {
			key := fmt.Sprintf("%04d-%02d-%02d", d.Date.Year, d.Date.Month, d.Date.Day)
			if _, e := time.Parse("2006-01-02", key); e != nil {
				return nil, e
			}
			if key < start {
				continue
			}
			out = append(out, Day{key, d.Rx, d.Tx})
		}
		if len(out) > limit {
			out = out[len(out)-limit:]
		}
		return out, nil
	}
	return nil, errors.New("vnStat database has no selected interface")
}
func collectDays(ctx context.Context, iface string, remote Remote, start string) ([]Day, error) {
	cmd := exec.CommandContext(ctx, "vnstat", "--config", "/etc/vnstat.conf", "-i", iface, "--json", "d", strconv.Itoa(remote.HistoryDays))
	cmd.Env = append(os.Environ(), "TZ="+remote.Timezone)
	data, e := cmd.Output()
	if e != nil {
		return nil, errors.New("vnStat read failed; check vnstat service and interface database")
	}
	return parseDays(data, iface, remote.HistoryDays, start)
}
func request(ctx context.Context, client *http.Client, cfg Config, path string, payload any, out any) error {
	var reader io.Reader
	method := "GET"
	if payload != nil {
		data, e := json.Marshal(payload)
		if e != nil {
			return e
		}
		reader = bytes.NewReader(data)
		method = "POST"
	}
	req, e := http.NewRequestWithContext(ctx, method, strings.TrimRight(cfg.Server, "/")+path, reader)
	if e != nil {
		return e
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "LightProbe/"+version)
	resp, e := client.Do(req)
	if e != nil {
		return errors.New("server connection failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("server returned HTTP %d", resp.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(resp.Body, 128*1024)).Decode(out)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
	return nil
}
func remoteConfig(ctx context.Context, client *http.Client, cfg Config) (Remote, error) {
	var r Remote
	e := request(ctx, client, cfg, "/api/agent/config", nil, &r)
	if e != nil {
		return r, e
	}
	if r.Interval < 3 || r.Interval > 60 || r.HistoryDays < 40 || r.HistoryDays > 730 || !zonePattern.MatchString(r.Timezone) || (r.Interface != "" && !interfacePattern.MatchString(r.Interface)) {
		return r, errors.New("invalid server configuration")
	}
	return r, nil
}
func main() {
	configPath := flag.String("config", "/etc/lightprobe-agent.json", "configuration path")
	printZone := flag.Bool("print-timezone", false, "fetch configured timezone and exit")
	check := flag.Bool("check", false, "collect one sample locally without submitting it")
	showVersion := flag.Bool("version", false, "print version")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	if runtime.GOOS != "linux" {
		log.Fatal("Linux only")
	}
	raw, e := os.ReadFile(*configPath)
	if e != nil {
		log.Fatal("cannot read configuration")
	}
	var cfg Config
	if json.Unmarshal(raw, &cfg) != nil {
		log.Fatal("invalid configuration JSON")
	}
	parsed, e := url.Parse(cfg.Server)
	if e != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(cfg.Token) {
		log.Fatal("invalid server URL or token")
	}
	if parsed.Scheme == "http" && parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" {
		log.Fatal("HTTPS is required for remote reporting")
	}
	if cfg.DiskPath == "" {
		cfg.DiskPath = "/"
	}
	if cfg.HistoryStart != "" {
		if _, e = time.Parse("2006-01-02", cfg.HistoryStart); e != nil {
			log.Fatal("invalid history_start")
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	remote, e := remoteConfig(ctx, client, cfg)
	if *printZone {
		if e != nil {
			log.Fatal(e)
		}
		fmt.Println(remote.Timezone)
		return
	}
	var prevCPU CPUCounter
	var prevNet Counters
	var prevIface string
	var prevTime time.Time
	var configAt, historyAt time.Time
	var forwardingAt time.Time
	var forwardSamples []ForwardSample
	backoff := time.Duration(0)
	if e == nil {
		configAt = time.Now()
	} else {
		log.Print("configuration unavailable; retrying")
	}
	for ctx.Err() == nil {
		if configAt.IsZero() || time.Since(configAt) >= 60*time.Second {
			r, err := remoteConfig(ctx, client, cfg)
			if err != nil {
				log.Print(err)
				if !wait(ctx, 30*time.Second) {
					return
				}
				continue
			}
			if remote.Timezone != "" && r.Timezone != remote.Timezone {
				log.Print("timezone changed; reinstall agent before continuing")
				if !wait(ctx, 60*time.Second) {
					return
				}
				continue
			}
			remote = r
			configAt = time.Now()
		}
		netRaw, err := os.ReadFile("/proc/net/dev")
		if err != nil {
			log.Print("network counters unavailable")
			if !wait(ctx, 10*time.Second) {
				return
			}
			continue
		}
		networks := parseNetwork(string(netRaw))
		iface := remote.Interface
		if iface == "" {
			iface, err = detectInterface(networks)
		}
		current, ok := networks[iface]
		if err != nil || !ok {
			log.Print("configured network interface unavailable")
			if !wait(ctx, 10*time.Second) {
				return
			}
			continue
		}
		at := time.Now()
		report := Report{Version: version, Interface: iface}
		report.Hostname, _ = os.Hostname()
		report.System = readSystem()
		if time.Since(forwardingAt) >= 30*time.Second {
			forwardSamples = collectForwarding(ctx, "/etc/firefly-forward")
			forwardingAt = time.Now()
		}
		report.Forwarding = forwardSamples
		for name := range networks {
			report.Interfaces = append(report.Interfaces, name)
		}
		cpuRaw, err := os.ReadFile("/proc/stat")
		currentCPU, cpuErr := parseCPU(string(cpuRaw))
		if err != nil || cpuErr != nil {
			report.SampleError = "CPU stats unavailable"
		}
		if !prevTime.IsZero() && iface == prevIface {
			seconds := at.Sub(prevTime).Seconds()
			report.RxSpeed = rate(prevNet.Rx, current.Rx, seconds)
			report.TxSpeed = rate(prevNet.Tx, current.Tx, seconds)
			report.CPU = cpuPercent(prevCPU, currentCPU)
		}
		prevCPU = currentCPU
		prevNet = current
		prevTime = at
		prevIface = iface
		memRaw, err := os.ReadFile("/proc/meminfo")
		report.MemTotal, report.MemUsed, cpuErr = parseMemory(string(memRaw))
		if err != nil || cpuErr != nil {
			report.SampleError = "memory stats unavailable"
		}
		report.DiskTotal, report.DiskUsed, err = diskUsage(cfg.DiskPath)
		if err != nil {
			report.SampleError = "disk stats unavailable"
		}
		uptime, _ := os.ReadFile("/proc/uptime")
		if f := strings.Fields(string(uptime)); len(f) > 0 {
			report.Uptime, _ = strconv.ParseFloat(f[0], 64)
		}
		if historyAt.IsZero() || time.Since(historyAt) >= 5*time.Minute {
			historyCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			days, historyErr := collectDays(historyCtx, iface, remote, cfg.HistoryStart)
			cancel()
			if days == nil {
				days = []Day{}
			}
			report.Days = &days
			report.HistoryTimezone = cfg.VnstatTimezone
			if historyErr != nil {
				report.HistoryError = historyErr.Error()
			}
			if historyErr == nil && cfg.HistoryStart != "" && len(days) == 0 {
				report.HistoryError = "waiting for first daily traffic sample in configured timezone"
			}
		}
		if *check {
			data, _ := json.MarshalIndent(report, "", "  ")
			fmt.Println(string(data))
			return
		}
		err = request(ctx, client, cfg, "/api/agent/report", report, nil)
		if err != nil {
			log.Print(err)
			if backoff == 0 {
				backoff = 5 * time.Second
			} else {
				backoff = time.Duration(math.Min(float64(backoff*2), float64(60*time.Second)))
			}
		} else {
			backoff = 0
			if report.Days != nil {
				historyAt = time.Now()
			}
		}
		delay := time.Duration(remote.Interval) * time.Second
		if backoff > delay {
			delay = backoff
		}
		if !wait(ctx, delay) {
			return
		}
	}
}
func wait(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
