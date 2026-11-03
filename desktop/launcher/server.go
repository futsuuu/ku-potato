package launcher

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/gofrs/flock"
)

const Endpoint = "http://127.0.0.1:8787"

type Manager struct {
	Endpoint string
	StateDir string
	Binary   string
}

// Ensure reuses the running server or launches a process that outlives the app.
func (m Manager) Ensure(ctx context.Context) (string, error) {
	if m.Endpoint == "" {
		m.Endpoint = Endpoint
	}
	ready, err := probe(ctx, m.Endpoint)
	if ready || err != nil {
		return m.Endpoint, err
	}
	if err := os.MkdirAll(m.StateDir, 0o700); err != nil {
		return "", err
	}
	lock := flock.New(filepath.Join(m.StateDir, "desktop-server-start.lock"))
	locked, err := lock.TryLockContext(ctx, 100*time.Millisecond)
	if err != nil || !locked {
		return "", fmt.Errorf("サーバの起動待ちに失敗しました: %w", err)
	}
	defer lock.Close()
	ready, err = probe(ctx, m.Endpoint)
	if ready || err != nil {
		return m.Endpoint, err
	}
	binary := m.Binary
	if binary == "" {
		binary, err = findBinary()
		if err != nil {
			return "", err
		}
	}
	if err := detach(binary, filepath.Join(m.StateDir, "server.log")); err != nil {
		return "", fmt.Errorf("サーバを起動できません: %w", err)
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		ready, err = probe(ctx, m.Endpoint)
		if ready || err != nil {
			return m.Endpoint, err
		}
		select {
		case <-ctx.Done():
			return "", fmt.Errorf("サーバが応答しません。server.logを確認してください: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func probe(ctx context.Context, endpoint string) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"/healthz", nil)
	if err != nil {
		return false, err
	}
	client := &http.Client{
		Timeout:       time.Second,
		Transport:     &http.Transport{Proxy: nil},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	defer client.CloseIdleConnections()
	response, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		var op *net.OpError
		if errors.As(err, &op) && op.Op == "dial" {
			return false, nil
		}
		return false, fmt.Errorf("サーバの確認に失敗しました: %w", err)
	}
	defer response.Body.Close()
	var health struct{ Status, Service string }
	if response.StatusCode != 200 || json.NewDecoder(response.Body).Decode(&health) != nil ||
		health.Status != "ok" ||
		health.Service != "ku-potato-server" {
		return false, fmt.Errorf("%s は KU-POTATO サーバではありません", endpoint)
	}
	return true, nil
}

func findBinary() (string, error) {
	name := "ku-potato-server"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	directories := []string{
		filepath.Dir(executable),
		filepath.Join(filepath.Dir(executable), "..", "Resources"),
	}
	for _, dir := range append(directories, developmentBinaryDirectories()...) {
		candidate := filepath.Join(dir, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	if binary, err := exec.LookPath(name); err == nil {
		return binary, nil
	}
	return "", fmt.Errorf("%s が見つかりません。デスクトップアプリと同じ場所に配置してください", name)
}

func detach(binary, logPath string) error {
	log, err := os.OpenFile(logPath, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer log.Close()
	input, err := os.Open(os.DevNull)
	if err != nil {
		return err
	}
	defer input.Close()
	command := exec.Command(binary)
	command.Stdin, command.Stdout, command.Stderr = input, log, log
	configureDetached(command)
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}
