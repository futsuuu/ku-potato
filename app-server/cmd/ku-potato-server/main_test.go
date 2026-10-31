package main

import "testing"

func TestListenAddressIsAlwaysLoopback(t *testing.T) {
	for _, address := range []string{"127.0.0.1:8787", "localhost:8787", "[::1]:8787"} {
		if _, err := loopbackAddress(address); err != nil {
			t.Fatal(address, err)
		}
	}
	for _, address := range []string{"0.0.0.0:8787", ":8787", "[::]:8787", "192.168.1.1:8787", "example.org:8787"} {
		if _, err := loopbackAddress(address); err == nil {
			t.Fatal("accepted public bind", address)
		}
	}
}
