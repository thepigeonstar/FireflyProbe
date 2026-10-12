//go:build !linux

package main

import "errors"

func diskUsage(path string) (uint64, uint64, error) { return 0, 0, errors.New("Linux only") }
