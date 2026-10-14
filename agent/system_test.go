package main

import "testing"

func TestSystemRelease(t *testing.T) {
	for _, c := range []struct{ raw, want string }{
		{"PRETTY_NAME=\"Debian GNU/Linux 11 (bullseye)\"", "Debian GNU/Linux 11 (bullseye)"},
		{"NAME='Alpine Linux'\nVERSION_ID=3.22.0", "Alpine Linux 3.22.0"},
		{"NAME=Ubuntu\nVERSION_ID=\"24.04\"", "Ubuntu 24.04"},
		{"OTHER=value", ""},
	} {
		if got := parseSystem(c.raw); got != c.want {
			t.Fatalf("%q: got %q want %q", c.raw, got, c.want)
		}
	}
}
