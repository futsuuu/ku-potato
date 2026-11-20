package telemetry

import (
	"bytes"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"go.opentelemetry.io/collector/pdata/plog/plogotlp"
	"golang.org/x/sys/unix"
)

func TestFileTransportRecoversPartialWrite(t *testing.T) {
	if os.Getenv("KU_POTATO_TEST_PARTIAL_WRITE") == "" {
		for _, scenario := range []string{"recover", "disable"} {
			t.Run(scenario, func(t *testing.T) {
				command := exec.Command(
					os.Args[0],
					"-test.run=^TestFileTransportRecoversPartialWrite$",
				)
				command.Env = append(os.Environ(), "KU_POTATO_TEST_PARTIAL_WRITE="+scenario)
				if output, err := command.CombinedOutput(); err != nil {
					t.Fatalf("partial write test: %v\n%s", err, output)
				}
			})
		}
		return
	}
	transport := fileTransport{directory: t.TempDir()}
	write := func(body string) error {
		t.Helper()
		export := plogotlp.NewExportRequest()
		export.Logs().ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().
			LogRecords().AppendEmpty().Body().SetStr(body)
		data, err := export.MarshalProto()
		if err != nil {
			t.Fatal(err)
		}
		request, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			"http://localhost/v1/logs", bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		response, err := transport.RoundTrip(request)
		if response != nil {
			_ = response.Body.Close()
		}
		return err
	}
	if err := write("before"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(transport.directory, "logs.jsonl")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("KU_POTATO_TEST_PARTIAL_WRITE") == "disable" {
		fd, err := unix.MemfdCreate("telemetry", unix.MFD_ALLOW_SEALING)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = unix.Close(fd) }()
		if _, err := unix.Write(fd, before); err != nil {
			t.Fatal(err)
		}
		if _, err := unix.FcntlInt(uintptr(fd), unix.F_ADD_SEALS, unix.F_SEAL_SHRINK); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink("/proc/self/fd/"+strconv.Itoa(fd), path); err != nil {
			t.Fatal(err)
		}
	}
	var limit unix.Rlimit
	if err := unix.Getrlimit(unix.RLIMIT_FSIZE, &limit); err != nil {
		t.Fatal(err)
	}
	limit.Cur = uint64(len(before) + 1024)
	if err := unix.Setrlimit(unix.RLIMIT_FSIZE, &limit); err != nil {
		t.Fatal(err)
	}
	if err := write(strings.Repeat("x", 8192)); err == nil {
		t.Fatal("oversized write succeeded")
	}
	after, err := os.ReadFile(path)
	if os.Getenv("KU_POTATO_TEST_PARTIAL_WRITE") == "disable" {
		if err != nil || len(after) != int(limit.Cur) {
			t.Fatalf(
				"expected an incomplete record after failed truncation: %d bytes, %v",
				len(after),
				err,
			)
		}
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, before, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := write("must not append"); err == nil {
			t.Fatal("transport reused a file after failed recovery")
		}
		return
	}
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("failed write changed existing records: %q, %v", after, err)
	}
	if err := write("after"); err != nil {
		t.Fatal(err)
	}
	messages := readMessages(t, transport.directory, "logs", plogotlp.NewExportRequest())
	if len(messages) != 2 {
		t.Fatalf("got %d records after recovery, want 2", len(messages))
	}
}
