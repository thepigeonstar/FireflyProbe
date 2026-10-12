//go:build linux

package main

import "syscall"

func diskUsage(path string) (uint64, uint64, error) {
	var s syscall.Statfs_t
	if e := syscall.Statfs(path, &s); e != nil {
		return 0, 0, e
	}
	total := s.Blocks * uint64(s.Bsize)
	// Match df's used blocks; reserved blocks remain free but not available.
	used := (s.Blocks - s.Bfree) * uint64(s.Bsize)
	return total, used, nil
}
