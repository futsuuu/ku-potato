package httpapi

import (
	"context"
	"errors"
	"net/http"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
	"github.com/futsuuu/ku-potato/app-server/application/inport"
	"github.com/futsuuu/ku-potato/app-server/application/operation"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

func registerStream[T, I any](
	api huma.API,
	op huma.Operation,
	handler func(context.Context, *I, inport.StatusObserver) (T, error),
) {
	validationErrors(api, &op)
	op.Responses["403"] = jsonResponse[errorBody](api, http.StatusText(http.StatusForbidden))
	op.Description = "Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work."
	sse.Register(
		api,
		op,
		map[string]any{
			"status": operation.OperationStatus{},
			"result": dataBody[T]{},
			"error":  errorBody{},
		},
		func(ctx context.Context, input *I, send sse.Sender) {
			last := operation.OperationStatus{}
			var sendErr error
			result, err := handler(ctx, input, func(status operation.OperationStatus) error {
				last = status
				sendErr = send.Data(status)
				return sendErr
			})
			if ctx.Err() != nil || sendErr != nil {
				return
			}
			last.Error = nil
			if err != nil {
				var response *responseError
				if !errors.As(failure(err), &response) {
					return
				}
				last.Status = "failed"
				if response.Failure.Reason == "authentication-required" {
					last.Status = "blocked"
				}
				if send.Data(last) != nil {
					return
				}
				_ = send.Data(response.errorBody)
				return
			}
			last.Status = "succeeded"
			completed := 1
			if last.Progress != nil && last.Progress.Total > 0 {
				completed = last.Progress.Total
			}
			last.Progress = &operation.Progress{
				Stage:     "completed",
				Completed: completed,
				Total:     completed,
			}
			if send.Data(last) != nil {
				return
			}
			_ = send.Data(dataBody[T]{Data: result})
		},
	)
}

// Document file and external results as a discriminated union rather than an
// object in which every variant's fields are optional.
type downloadResult struct {
	Type        string            `json:"type"`
	File        *domain.SavedFile `json:"file,omitempty"`
	DownloadURL string            `json:"downloadUrl,omitempty"`
	URL         string            `json:"url,omitempty"`
}
type fileDownload struct {
	Type        string           `json:"type" enum:"file"`
	File        domain.SavedFile `json:"file"`
	DownloadURL string           `json:"downloadUrl" pattern:"^/materials/[A-Z]+[0-9]+/resources/SRS[0-9]+/file$"`
}
type externalDownload struct {
	Type string `json:"type" enum:"external"`
	URL  string `json:"url" format:"uri" pattern:"^https?://"`
}

func (downloadResult) Schema(r huma.Registry) *huma.Schema {
	return &huma.Schema{OneOf: []*huma.Schema{
		r.Schema(reflect.TypeFor[fileDownload](), true, ""),
		r.Schema(reflect.TypeFor[externalDownload](), true, ""),
	}}
}
