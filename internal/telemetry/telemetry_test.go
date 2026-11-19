package telemetry

import (
	"bytes"
	"context"
	"encoding/hex"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/collector/pdata/plog/plogotlp"
	"go.opentelemetry.io/collector/pdata/pmetric/pmetricotlp"
	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.opentelemetry.io/otel"
	collectorlog "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collectormetric "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	common "go.opentelemetry.io/proto/otlp/common/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthproto "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/proto"
)

func TestExportRPCSignalsAndContext(t *testing.T) {
	logger := slog.Default()
	tracerProvider := otel.GetTracerProvider()
	meterProvider := otel.GetMeterProvider()
	propagator := otel.GetTextMapPropagator()
	t.Cleanup(func() {
		slog.SetDefault(logger)
		otel.SetTracerProvider(tracerProvider)
		otel.SetMeterProvider(meterProvider)
		otel.SetTextMapPropagator(propagator)
	})
	directory := t.TempDir()
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	t.Setenv("OTEL_SDK_DISABLED", "true")
	t.Setenv(
		"OTEL_RESOURCE_ATTRIBUTES",
		"service.name=must-not-override,service.instance.id=must-not-override,environment=test",
	)
	shutdown, err := Init(t.Context(), "test-browser", directory)
	if err != nil {
		t.Fatal(err)
	}
	listener := bufconn.Listen(1024 * 1024)
	server := grpc.NewServer(
		grpc.WaitForHandlers(true),
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
		grpc.ChainUnaryInterceptor(UnaryServerInterceptor()),
		grpc.ChainStreamInterceptor(StreamServerInterceptor()),
	)
	healthproto.RegisterHealthServer(server, health.NewServer())
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	connection, err := grpc.NewClient("passthrough:///telemetry",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) {
			return listener.Dial()
		}),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ctx = metadata.NewOutgoingContext(ctx, metadata.Pairs(
		"traceparent", "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
		"x-ku-potato-worker-token", "must-not-export-this-secret",
	))
	client := healthproto.NewHealthClient(connection)
	if _, err := client.Check(ctx, &healthproto.HealthCheckRequest{}); err != nil {
		t.Fatal(err)
	}
	streamCtx, stopStream := context.WithCancel(ctx)
	stream, err := client.Watch(streamCtx, &healthproto.HealthCheckRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Recv(); err != nil {
		t.Fatal(err)
	}
	stopStream()
	server.Stop()
	if err := shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 1 {
		t.Fatalf("recording directories: %v %v", entries, err)
	}
	recording := filepath.Join(directory, entries[0].Name())
	instanceID := strings.TrimPrefix(entries[0].Name(), "test-browser-")
	payloads := map[string][][]byte{
		"/v1/traces":  readMessages(t, recording, "traces", ptraceotlp.NewExportRequest()),
		"/v1/metrics": readMessages(t, recording, "metrics", pmetricotlp.NewExportRequest()),
		"/v1/logs":    readMessages(t, recording, "logs", plogotlp.NewExportRequest()),
	}
	spanIDs := make(map[string]bool)
	for _, data := range payloads["/v1/traces"] {
		request := &collectortrace.ExportTraceServiceRequest{}
		if err := proto.Unmarshal(data, request); err != nil {
			t.Fatal(err)
		}
		for _, resource := range request.GetResourceSpans() {
			assertServiceInstance(t, resource.GetResource().GetAttributes(), instanceID)
			for _, attr := range resource.GetResource().GetAttributes() {
				if attr.GetKey() == "service.name" &&
					attr.GetValue().GetStringValue() != "test-browser" {
					t.Fatalf("unexpected service name: %v", attr)
				}
			}
			for _, scope := range resource.GetScopeSpans() {
				for _, span := range scope.GetSpans() {
					if hex.EncodeToString(
						span.GetTraceId(),
					) != "0123456789abcdef0123456789abcdef" ||
						hex.EncodeToString(span.GetParentSpanId()) != "0123456789abcdef" {
						t.Fatalf("lost remote parent: %v", span)
					}
					spanIDs[string(span.GetSpanId())] = true
				}
			}
		}
	}
	if len(spanIDs) != 2 {
		t.Fatalf("expected unary and streaming spans, got %d", len(spanIDs))
	}
	correlatedLogs := 0
	for _, data := range payloads["/v1/logs"] {
		request := &collectorlog.ExportLogsServiceRequest{}
		if err := proto.Unmarshal(data, request); err != nil {
			t.Fatal(err)
		}
		for _, resource := range request.GetResourceLogs() {
			assertServiceInstance(t, resource.GetResource().GetAttributes(), instanceID)
			for _, scope := range resource.GetScopeLogs() {
				for _, record := range scope.GetLogRecords() {
					if record.GetBody().GetStringValue() == "RPC completed" &&
						spanIDs[string(record.GetSpanId())] {
						correlatedLogs++
					}
				}
			}
		}
	}
	if correlatedLogs != 2 {
		t.Fatalf("expected two trace-correlated logs, got %d", correlatedLogs)
	}
	metricCount := 0
	for _, data := range payloads["/v1/metrics"] {
		request := &collectormetric.ExportMetricsServiceRequest{}
		if err := proto.Unmarshal(data, request); err != nil {
			t.Fatal(err)
		}
		for _, resource := range request.GetResourceMetrics() {
			assertServiceInstance(t, resource.GetResource().GetAttributes(), instanceID)
			for _, scope := range resource.GetScopeMetrics() {
				metricCount += len(scope.GetMetrics())
			}
		}
	}
	if metricCount == 0 {
		t.Fatal("no RPC metrics exported")
	}
	for path, batches := range payloads {
		for _, data := range batches {
			if bytes.Contains(data, []byte("must-not-export-this-secret")) {
				t.Fatalf("authentication token exported to %s", path)
			}
		}
	}
}

func TestRecordingsArePrivateAndDoNotOverwritePreviousRuns(t *testing.T) {
	logger := slog.Default()
	tracerProvider := otel.GetTracerProvider()
	meterProvider := otel.GetMeterProvider()
	propagator := otel.GetTextMapPropagator()
	t.Cleanup(func() {
		slog.SetDefault(logger)
		otel.SetTracerProvider(tracerProvider)
		otel.SetMeterProvider(meterProvider)
		otel.SetTextMapPropagator(propagator)
	})
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:1")
	directory := t.TempDir()
	for range 2 {
		shutdown, err := Init(t.Context(), "test-browser", directory)
		if err != nil {
			t.Fatal(err)
		}
		if err := shutdown(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 2 {
		t.Fatalf("recordings were overwritten: %v %v", entries, err)
	}
	for _, entry := range entries {
		recording := filepath.Join(directory, entry.Name())
		instanceID := strings.TrimPrefix(entry.Name(), "test-browser-")
		for _, data := range readMessages(t, recording, "logs", plogotlp.NewExportRequest()) {
			request := &collectorlog.ExportLogsServiceRequest{}
			if err := proto.Unmarshal(data, request); err != nil {
				t.Fatal(err)
			}
			for _, resource := range request.GetResourceLogs() {
				assertServiceInstance(t, resource.GetResource().GetAttributes(), instanceID)
			}
		}
		for _, path := range []string{recording, filepath.Join(recording, "logs.jsonl")} {
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
				t.Fatalf("recording is accessible to other users: %s %v", path, info.Mode())
			}
		}
	}
}

func TestInvalidRecordingDirectoryFailsInitialization(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(directory, []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	shutdown, err := Init(t.Context(), "test-browser", directory)
	if err == nil || shutdown != nil {
		t.Fatalf("invalid recording directory was accepted: %v", err)
	}
}

func assertServiceInstance(t *testing.T, attributes []*common.KeyValue, instanceID string) {
	t.Helper()
	id, err := uuid.Parse(instanceID)
	if err != nil || id.Version() != 4 {
		t.Fatalf("expected a version 4 UUID, got %q", instanceID)
	}
	for _, attribute := range attributes {
		if attribute.GetKey() == "service.instance.id" {
			if attribute.GetValue().GetStringValue() != instanceID {
				t.Fatalf("unexpected service.instance.id: %v, want %q", attribute, instanceID)
			}
			return
		}
	}
	t.Fatal("service.instance.id is missing")
}

func readMessages(t *testing.T, directory, signal string, message interface {
	UnmarshalJSON([]byte) error
	MarshalProto() ([]byte, error)
},
) [][]byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(directory, signal+".jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var messages [][]byte
	for line := range bytes.SplitSeq(data, []byte{'\n'}) {
		if len(line) == 0 {
			continue
		}
		if err := message.UnmarshalJSON(line); err != nil {
			t.Fatal(err)
		}
		data, err := message.MarshalProto()
		if err != nil {
			t.Fatal(err)
		}
		messages = append(messages, data)
	}
	return messages
}
