package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type resourceOpener struct {
	endpoint    string
	sharedFiles bool
	tempDir     string
}

func (o resourceOpener) open(
	ctx context.Context,
	material, resource string,
	launch func(string) error,
) error {
	return o.openPath(
		ctx,
		fmt.Sprintf(
			"/materials/%s/resources/%s",
			url.PathEscape(material),
			url.PathEscape(resource),
		),
		launch,
	)
}

func (o resourceOpener) openGoogleDriveFile(
	ctx context.Context,
	file string,
	launch func(string) error,
) error {
	return o.openPath(ctx, "/google-drive/files/"+url.PathEscape(file), launch)
}

func (o resourceOpener) openPath(
	ctx context.Context,
	resourcePath string,
	launch func(string) error,
) error {
	endpoint, err := url.Parse(o.endpoint)
	if err != nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") ||
		endpoint.Host == "" ||
		endpoint.User != nil ||
		endpoint.RawQuery != "" ||
		endpoint.Fragment != "" {
		return fmt.Errorf("invalid server URL")
	}
	method, action := http.MethodGet, "file"
	if o.sharedFiles {
		method, action = http.MethodPost, "prepare"
	}
	requestURL := strings.TrimRight(o.endpoint, "/") + resourcePath + "/" + action
	req, err := http.NewRequestWithContext(ctx, method, requestURL, nil)
	if err != nil {
		return err
	}
	client := &http.Client{
		Transport:     &http.Transport{Proxy: nil},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	defer client.CloseIdleConnections()
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		var failure struct {
			Error  struct{ Message string }
			Detail string
		}
		_ = json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&failure)
		if failure.Error.Message != "" {
			return fmt.Errorf("%s", failure.Error.Message)
		}
		if failure.Detail != "" {
			return fmt.Errorf("%s", failure.Detail)
		}
		return fmt.Errorf("server returned HTTP %d", response.StatusCode)
	}
	if o.sharedFiles {
		var result struct{ Data struct{ Path string } }
		if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).
			Decode(&result); err != nil {
			return err
		}
		path := result.Data.Path
		if !filepath.IsAbs(path) {
			return fmt.Errorf("server returned a nonabsolute file path")
		}
		info, err := os.Stat(path)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("server returned a nonregular file")
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		return launch(path)
	}
	_, params, err := mime.ParseMediaType(response.Header.Get("Content-Disposition"))
	if err != nil {
		return err
	}
	name := filepath.Base(strings.ReplaceAll(params["filename"], "\\", "/"))
	if name == "" || name == "." || name == ".." || name == "/" ||
		strings.ContainsAny(name, "\x00:") {
		name = "resource"
	}
	dir, err := os.MkdirTemp(o.tempDir, "ku-potato-opened-resource-")
	if err != nil {
		return err
	}
	success := false
	defer func() {
		if !success {
			_ = os.RemoveAll(dir)
		}
	}()
	path := filepath.Join(dir, name)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, response.Body)
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := launch(path); err != nil {
		return err
	}
	success = true
	return nil
}
