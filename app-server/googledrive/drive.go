package googledrive

import (
	"bufio"
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/futsuuu/ku-potato/app-server/domain"
	"golang.org/x/net/html"
)

var driveID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,256}$`)
var driveRange = regexp.MustCompile(`^bytes 0-([0-9]+)/([0-9]+|\*)$`)

// FileMetadata describes the downloadable representation, not a Workspace
// document's storage usage. Size is -1 when the server omits the total size.
// This capability belongs only to the adapter; it is not an application port.
type FileMetadata struct {
	Filename string
	MIMEType string
	Size     int64
}

// Drive consumes short-lived cookies without owning a Chrome profile.
type DriveCookieSource interface {
	CookieJar(context.Context) (http.CookieJar, error)
}

type Drive struct {
	cookies   DriveCookieSource
	directory string
}

func New(cookies DriveCookieSource, directory string) *Drive {
	return &Drive{cookies: cookies, directory: directory}
}

func (g *Drive) Key(rawURL string) (string, bool) {
	destination, ok := driveDownloadURL(rawURL)
	if !ok {
		return "", false
	}
	return destination.String(), true
}

func (g *Drive) Download(ctx context.Context, rawURL string) (string, string, error) {
	destination, ok := driveDownloadURL(rawURL)
	if !ok {
		return "", "", nil
	}
	client, err := g.driveClient(ctx)
	if err != nil {
		return "", "", googleDownloadError(ctx, err)
	}
	defer client.client.CloseIdleConnections()
	path, filename, err := client.download(ctx, destination, g.directory)
	return path, filename, googleDownloadError(ctx, err)
}

// FileMetadata requests at most a 512-byte sample, without saving a file.
// Some servers ignore Range; their body is closed after reading the sample.
func (g *Drive) FileMetadata(ctx context.Context, rawURL string) (FileMetadata, error) {
	destination, ok := driveDownloadURL(rawURL)
	if !ok {
		return FileMetadata{}, domain.Fail("unsupported-resource", "この外部資料のメタデータ取得には対応していません。")
	}
	d, err := g.driveClient(ctx)
	if err != nil {
		return FileMetadata{}, googleDownloadError(ctx, err)
	}
	defer d.client.CloseIdleConnections()
	response, metadata, err := d.open(ctx, destination, true)
	if response != nil {
		response.Body.Close()
	}
	return metadata, googleDownloadError(ctx, err)
}

func driveDownloadURL(raw string) (*url.URL, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return nil, false
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	id := ""
	switch u.Hostname() {
	case "drive.google.com":
		if len(parts) >= 3 && parts[0] == "file" && parts[1] == "d" {
			id = parts[2]
		} else if len(parts) == 1 && (parts[0] == "open" || parts[0] == "uc" || parts[0] == "download") {
			id = u.Query().Get("id")
		}
	case "docs.google.com":
		if len(parts) >= 3 && (parts[0] == "document" || parts[0] == "presentation" || parts[0] == "spreadsheets") {
			if parts[1] == "d" && parts[2] != "e" {
				id = parts[2]
			} else if len(parts) >= 5 && parts[1] == "u" && parts[3] == "d" {
				id = parts[4]
			}
		}
	case "colab.research.google.com":
		if len(parts) >= 2 && parts[0] == "drive" {
			id = parts[1]
		}
	}
	if !driveID.MatchString(id) {
		return nil, false
	}
	q := url.Values{"id": {id}, "export": {"download"}, "authuser": {"0"}}
	if key := u.Query().Get("resourcekey"); key != "" {
		q.Set("resourcekey", key)
	}
	return &url.URL{Scheme: "https", Host: "drive.google.com", Path: "/uc", RawQuery: q.Encode()}, true
}

type driveHTTP struct{ client *http.Client }

func (g *Drive) driveClient(ctx context.Context) (*driveHTTP, error) {
	jar, err := g.cookies.CookieJar(ctx)
	if err != nil {
		return nil, err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	return &driveHTTP{client: &http.Client{
		Jar:           jar,
		Transport:     transport,
		CheckRedirect: driveRedirect,
	}}, nil
}

func driveEndpoint(u *url.URL) bool {
	if u == nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	host := u.Hostname()
	return host == "drive.google.com" || host == "drive.usercontent.google.com" ||
		host == "googleusercontent.com" || strings.HasSuffix(host, ".googleusercontent.com")
}

func driveRedirect(request *http.Request, via []*http.Request) error {
	if request.URL.Hostname() == "accounts.google.com" {
		return domain.Fail("authentication-required", "Googleにログインし直してください。")
	}
	if len(via) >= 10 || !driveEndpoint(request.URL) {
		return domain.Fail("source", "Google Driveの転送先が不正です。")
	}
	return nil
}

// open handles the bounded virus-scan confirmation page for both downloads and
// probes. It never treats an HTTP 200 login/error page as a downloaded file.
func (d *driveHTTP) open(ctx context.Context, destination *url.URL, probe bool) (*http.Response, FileMetadata, error) {
	id := destination.Query().Get("id")
	resourceKey := destination.Query().Get("resourcekey")
	for attempt := 0; attempt < 3; attempt++ {
		if !driveEndpoint(destination) {
			return nil, FileMetadata{}, domain.Fail("source", "Google Driveの取得先が不正です。")
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, destination.String(), nil)
		if err != nil {
			return nil, FileMetadata{}, err
		}
		request.Header.Set("Accept-Encoding", "identity")
		if probe {
			request.Header.Set("Range", "bytes=0-511")
		}
		response, err := d.client.Do(request)
		if err != nil {
			return nil, FileMetadata{}, err
		}
		if response.StatusCode == http.StatusUnauthorized {
			response.Body.Close()
			return nil, FileMetadata{}, domain.Fail("authentication-required", "Googleにログインし直してください。")
		}
		if response.StatusCode == http.StatusForbidden {
			response.Body.Close()
			return nil, FileMetadata{}, domain.Fail("forbidden", "このGoogle Drive資料をダウンロードする権限がありません。")
		}
		if response.StatusCode != http.StatusOK && !(probe && response.StatusCode == http.StatusPartialContent) {
			response.Body.Close()
			return nil, FileMetadata{}, domain.Fail("source", "Google Driveからファイルを取得できません。")
		}
		disposition, params, _ := mime.ParseMediaType(response.Header.Get("Content-Disposition"))
		if disposition == "attachment" && params["filename"] != "" {
			metadata, err := driveMetadata(response, params["filename"], probe)
			if err != nil {
				response.Body.Close()
				return nil, FileMetadata{}, err
			}
			return response, metadata, nil
		}
		// Only a small HTML confirmation page is buffered, never a large file.
		body, readErr := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
		response.Body.Close()
		if readErr != nil {
			return nil, FileMetadata{}, readErr
		}
		if len(body) > 1<<20 {
			return nil, FileMetadata{}, domain.Fail("source", "Google Driveの確認ページが大きすぎます。")
		}
		next, err := driveConfirmation(body, response.Request.URL, id, resourceKey)
		if err != nil {
			return nil, FileMetadata{}, err
		}
		destination = next
	}
	return nil, FileMetadata{}, domain.Fail("source", "Google Driveのダウンロード確認が完了しません。")
}

func driveMetadata(response *http.Response, filename string, probe bool) (FileMetadata, error) {
	filename = path.Base(strings.ReplaceAll(filename, `\`, "/"))
	if filename == "." || filename == "/" || strings.ContainsAny(filename, "\x00\r\n") {
		return FileMetadata{}, domain.Fail("source", "Google Driveのファイル名が不正です。")
	}
	metadata := FileMetadata{Filename: filename, Size: response.ContentLength}
	if response.StatusCode == http.StatusPartialContent {
		match := driveRange.FindStringSubmatch(response.Header.Get("Content-Range"))
		if match == nil {
			return FileMetadata{}, domain.Fail("source", "Google Driveの部分応答が不正です。")
		}
		end, err := strconv.ParseInt(match[1], 10, 64)
		if err != nil || end > 511 || (response.ContentLength >= 0 && response.ContentLength != end+1) {
			return FileMetadata{}, domain.Fail("source", "Google Driveの部分応答サイズが不正です。")
		}
		metadata.Size = -1
		if match[2] != "*" {
			metadata.Size, err = strconv.ParseInt(match[2], 10, 64)
			if err != nil || metadata.Size <= end {
				return FileMetadata{}, domain.Fail("source", "Google Driveの全体サイズが不正です。")
			}
		}
	}
	metadata.MIMEType, _, _ = mime.ParseMediaType(response.Header.Get("Content-Type"))
	if metadata.MIMEType == "" || metadata.MIMEType == "application/octet-stream" {
		metadata.MIMEType, _, _ = mime.ParseMediaType(mime.TypeByExtension(strings.ToLower(path.Ext(filename))))
		switch strings.ToLower(path.Ext(filename)) {
		case ".pptx":
			metadata.MIMEType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
		case ".ipynb":
			metadata.MIMEType = "application/x-ipynb+json"
		}
		if metadata.MIMEType == "" {
			reader := bufio.NewReaderSize(response.Body, 512)
			sample, err := reader.Peek(512)
			if err != nil && err != io.EOF {
				return FileMetadata{}, err
			}
			metadata.MIMEType, _, _ = mime.ParseMediaType(http.DetectContentType(sample))
			response.Body = struct {
				io.Reader
				io.Closer
			}{reader, response.Body}
		}
	}
	if probe {
		if _, err := io.Copy(io.Discard, io.LimitReader(response.Body, 512)); err != nil {
			return FileMetadata{}, err
		}
	}
	return metadata, nil
}

func driveConfirmation(body []byte, base *url.URL, id, resourceKey string) (*url.URL, error) {
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	var form *html.Node
	var find func(*html.Node)
	find = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "form" && htmlAttribute(n, "id") == "download-form" {
			form = n
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			find(child)
		}
	}
	find(doc)
	if form == nil {
		return nil, domain.Fail("unsupported-resource", "Google Driveがファイルを返しませんでした。アクセス権とファイル形式を確認してください。")
	}
	action, err := url.Parse(htmlAttribute(form, "action"))
	if err != nil {
		return nil, domain.Fail("source", "Google Driveの確認フォームが不正です。")
	}
	destination := base.ResolveReference(action)
	method := strings.ToLower(htmlAttribute(form, "method"))
	if !driveEndpoint(destination) || destination.Hostname() != "drive.usercontent.google.com" || destination.Path != "/download" || (method != "" && method != "get") {
		return nil, domain.Fail("source", "Google Driveの確認フォームの送信先が不正です。")
	}
	q := destination.Query()
	var inputs func(*html.Node)
	inputs = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "input" && strings.EqualFold(htmlAttribute(n, "type"), "hidden") {
			if name := htmlAttribute(n, "name"); name != "" {
				q.Set(name, htmlAttribute(n, "value"))
			}
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			inputs(child)
		}
	}
	inputs(form)
	if q.Get("id") != id || q.Get("export") != "download" || q.Get("confirm") == "" {
		return nil, domain.Fail("source", "Google Driveの確認フォームの項目が不正です。")
	}
	if resourceKey != "" {
		q.Set("resourcekey", resourceKey)
	}
	destination.RawQuery = q.Encode()
	return destination, nil
}

func htmlAttribute(node *html.Node, name string) string {
	for _, attribute := range node.Attr {
		if attribute.Key == name {
			return attribute.Val
		}
	}
	return ""
}

func googleDownloadError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var failure *domain.Error
	if errors.As(err, &failure) {
		// HTTP errors may wrap a URL containing confirmation/session tokens.
		// Keep only the public error, never the transport's URL diagnostics.
		if failure.Reason == "authentication-required" {
			return &domain.AuthenticationError{Provider: "google", Err: failure}
		}
		return failure
	}
	return domain.Fail("source", "Google Driveからの取得に失敗しました。通信状態を確認してください。")
}

func (d *driveHTTP) download(ctx context.Context, destination *url.URL, directory string) (string, string, error) {
	response, metadata, err := d.open(ctx, destination, false)
	if err != nil {
		return "", "", err
	}
	defer response.Body.Close()
	file, err := os.CreateTemp(directory, "drive-*")
	if err != nil {
		return "", "", err
	}
	success := false
	defer func() {
		file.Close()
		if !success {
			os.Remove(file.Name())
		}
	}()
	size, err := io.Copy(file, response.Body)
	if err != nil {
		return "", "", err
	}
	if metadata.Size >= 0 && size != metadata.Size {
		return "", "", io.ErrUnexpectedEOF
	}
	if err = ctx.Err(); err != nil {
		return "", "", err
	}
	if err = file.Close(); err != nil {
		return "", "", err
	}
	success = true
	return file.Name(), metadata.Filename, nil
}
