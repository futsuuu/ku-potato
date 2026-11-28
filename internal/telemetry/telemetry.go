package telemetry

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/futsuuu/ku-potato/internal/appdirs"
	"github.com/google/uuid"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/status"
)

func Init(ctx context.Context, service, directory string) (func(context.Context) error, error) {
	if directory == "" {
		directories, err := appdirs.DefaultDirectories(service)
		if err != nil {
			return nil, err
		}
		directory = filepath.Join(directories.State, "telemetry")
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	instanceID := uuid.NewString()
	directory = filepath.Join(directory, service+"-"+instanceID)
	if err := os.Mkdir(directory, 0o700); err != nil {
		return nil, err
	}
	client := &http.Client{Transport: &fileTransport{directory: directory}}
	otel.SetTextMapPropagator(propagation.TraceContext{})
	var shutdowns []func(context.Context) error
	shutdown := func(ctx context.Context) error {
		var result error
		for _, stop := range shutdowns {
			result = errors.Join(result, stop(ctx))
		}
		return result
	}
	res, err := resource.New(ctx,
		resource.WithFromEnv(),
		resource.WithTelemetrySDK(),
		resource.WithAttributes(
			attribute.String("service.name", service),
			attribute.String("service.instance.id", instanceID),
			attribute.Int("process.pid", os.Getpid()),
		),
	)
	if err != nil {
		return nil, err
	}
	traceExporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithHTTPClient(client),
		otlptracehttp.WithEndpoint("localhost"),
		otlptracehttp.WithInsecure(),
		otlptracehttp.WithURLPath("/v1/traces"),
		otlptracehttp.WithCompression(otlptracehttp.NoCompression),
		otlptracehttp.WithRetry(otlptracehttp.RetryConfig{Enabled: false}),
	)
	if err != nil {
		return nil, err
	}
	traces := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(traceExporter),
	)
	shutdowns = append(shutdowns, traces.Shutdown)
	metricExporter, err := otlpmetrichttp.New(ctx,
		otlpmetrichttp.WithHTTPClient(client),
		otlpmetrichttp.WithEndpoint("localhost"),
		otlpmetrichttp.WithInsecure(),
		otlpmetrichttp.WithURLPath("/v1/metrics"),
		otlpmetrichttp.WithCompression(otlpmetrichttp.NoCompression),
		otlpmetrichttp.WithRetry(otlpmetrichttp.RetryConfig{Enabled: false}),
	)
	if err != nil {
		return nil, errors.Join(err, shutdown(ctx))
	}
	metrics := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(
			sdkmetric.NewPeriodicReader(metricExporter, sdkmetric.WithInterval(10*time.Second)),
		),
	)
	shutdowns = append(shutdowns, metrics.Shutdown)
	logExporter, err := otlploghttp.New(ctx,
		otlploghttp.WithHTTPClient(client),
		otlploghttp.WithEndpoint("localhost"),
		otlploghttp.WithInsecure(),
		otlploghttp.WithURLPath("/v1/logs"),
		otlploghttp.WithCompression(otlploghttp.NoCompression),
		otlploghttp.WithRetry(otlploghttp.RetryConfig{Enabled: false}),
	)
	if err != nil {
		return nil, errors.Join(err, shutdown(ctx))
	}
	logs := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(logExporter)),
	)
	shutdowns = append(shutdowns, logs.Shutdown)
	otel.SetTracerProvider(traces)
	otel.SetMeterProvider(metrics)
	slog.SetDefault(slog.New(slog.NewMultiHandler(
		slog.NewTextHandler(os.Stderr, nil),
		otelslog.NewHandler(service, otelslog.WithLoggerProvider(logs)),
	)))
	slog.Info("Telemetry recording", "directory", directory)
	return shutdown, nil
}

func UnaryServerInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, request any, info *grpc.UnaryServerInfo, next grpc.UnaryHandler) (any, error) {
		start := time.Now()
		response, err := next(ctx, request)
		slog.InfoContext(ctx, "RPC completed",
			"rpc.method", info.FullMethod,
			"rpc.grpc.status_code", int(status.Code(err)),
			"duration", time.Since(start),
		)
		return response, err
	}
}

func StreamServerInterceptor() grpc.StreamServerInterceptor {
	return func(service any, stream grpc.ServerStream, info *grpc.StreamServerInfo, next grpc.StreamHandler) error {
		start := time.Now()
		err := next(service, stream)
		slog.InfoContext(stream.Context(), "RPC completed",
			"rpc.method", info.FullMethod,
			"rpc.grpc.status_code", int(status.Code(err)),
			"duration", time.Since(start),
		)
		return err
	}
}
