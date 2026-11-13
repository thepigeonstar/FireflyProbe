package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

type firstDayState struct {
	Identity  string `json:"identity"`
	Date      string `json:"date"`
	Interface string `json:"interface"`
	Timezone  string `json:"timezone"`
	Boot      string `json:"boot"`
	LastRx    uint64 `json:"last_rx"`
	LastTx    uint64 `json:"last_tx"`
	Rx        uint64 `json:"rx"`
	Tx        uint64 `json:"tx"`
}

func firstDayIdentity(cfg Config) string {
	sum := sha256.Sum256([]byte(cfg.Server + "\n" + cfg.Token))
	return hex.EncodeToString(sum[:])
}
func advanceFirstDay(s *firstDayState, cfg Config, iface, zone, boot string, at time.Time, current Counters) (*Day, error) {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return nil, err
	}
	if s.Date != at.In(loc).Format("2006-01-02") {
		return nil, nil
	}
	if s.Identity != firstDayIdentity(cfg) || s.Interface != iface || s.Timezone != zone || boot == "" {
		return nil, errors.New("first-day checkpoint does not match this node/interface/timezone or boot identity")
	}
	delta := func(old, now uint64) uint64 {
		if s.Boot != boot || now < old {
			return now
		}
		return now - old
	}
	rx, tx := delta(s.LastRx, current.Rx), delta(s.LastTx, current.Tx)
	if s.Rx > 8e15 || s.Tx > 8e15 || rx > 8e15-s.Rx || tx > 8e15-s.Tx {
		return nil, errors.New("first-day counter out of range")
	}
	s.Rx += rx
	s.Tx += tx
	s.LastRx = current.Rx
	s.LastTx = current.Tx
	s.Boot = boot
	return &Day{Date: s.Date, Rx: s.Rx, Tx: s.Tx}, nil
}
func collectFirstDay(path string, cfg Config, iface, zone, boot string, at time.Time, current Counters) (*Day, error) {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, errors.New("cannot read first-day checkpoint")
	}
	var state firstDayState
	if json.Unmarshal(raw, &state) != nil {
		return nil, errors.New("invalid first-day checkpoint")
	}
	day, err := advanceFirstDay(&state, cfg, iface, zone, boot, at, current)
	if err != nil || day == nil {
		return day, err
	}
	raw, err = json.Marshal(state)
	if err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".first-day-*")
	if err != nil {
		return nil, errors.New("cannot save first-day checkpoint")
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	if _, err = file.Write(raw); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return nil, err
	}
	if err = os.Rename(tmp, path); err != nil {
		return nil, errors.New("cannot replace first-day checkpoint")
	}
	return day, nil
}
