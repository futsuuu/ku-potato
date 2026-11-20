package telemetry

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"go.opentelemetry.io/collector/pdata/plog/plogotlp"
	"go.opentelemetry.io/collector/pdata/pmetric/pmetricotlp"
	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"
)

type fileTransport struct {
	directory string
	mu        sync.Mutex
	failures  map[string]error
}

func (t *fileTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	defer func() { _ = request.Body.Close() }()
	if err := request.Context().Err(); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(request.Body)
	if err != nil {
		return nil, err
	}
	signal := strings.TrimPrefix(request.URL.Path, "/v1/")
	switch signal {
	case "traces":
		export := ptraceotlp.NewExportRequest()
		if err := export.UnmarshalProto(data); err != nil {
			return nil, err
		}
		data, err = export.MarshalJSON()
	case "metrics":
		export := pmetricotlp.NewExportRequest()
		if err := export.UnmarshalProto(data); err != nil {
			return nil, err
		}
		data, err = export.MarshalJSON()
	case "logs":
		export := plogotlp.NewExportRequest()
		if err := export.UnmarshalProto(data); err != nil {
			return nil, err
		}
		data, err = export.MarshalJSON()
	default:
		return nil, fmt.Errorf("unsupported telemetry path: %s", request.URL.Path)
	}
	if err != nil {
		return nil, err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if err := t.failures[signal]; err != nil {
		return nil, err
	}
	file, err := os.OpenFile(
		filepath.Join(t.directory, signal+".jsonl"),
		os.O_CREATE|os.O_APPEND|os.O_WRONLY,
		0o600,
	)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		return nil, errors.Join(err, file.Close())
	}
	n, err := file.Write(append(data, '\n'))
	if err != nil && n > 0 {
		if recovery := file.Truncate(info.Size()); recovery != nil {
			err = errors.Join(err, fmt.Errorf("restore telemetry record boundary: %w", recovery))
			if t.failures == nil {
				t.failures = make(map[string]error)
			}
			t.failures[signal] = err
		}
	}
	if err := errors.Join(err, file.Close()); err != nil {
		return nil, err
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": {"application/x-protobuf"}},
		Body:       io.NopCloser(strings.NewReader("")),
		Request:    request,
	}, nil
}
