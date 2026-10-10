import createClient from "openapi-fetch";
import type { components, operations, paths } from "./api.generated";
import { readEvents } from "./sse";

export type Schema = components["schemas"];
export type Status = Schema["OperationStatus"];
export type Sync = "auto" | "true" | "false";
type StreamEvent<K extends keyof operations> = operations[K] extends {
  responses: { 200: { content: { "text/event-stream": (infer E)[] } } };
}
  ? E
  : never;
export type Result<K extends keyof operations> =
  Extract<StreamEvent<K>, { event: "result" }> extends {
    data: { data: infer T };
  }
    ? T
    : never;
export interface Observe {
  signal?: AbortSignal;
  onStatus?: (status: Status) => void;
}

export function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object") {
    if ("error" in value) return errorMessage(value.error);
    if ("message" in value && typeof value.message === "string") return value.message;
    if ("detail" in value && typeof value.detail === "string") return value.detail;
  }
  return "処理に失敗しました。もう一度お試しください。";
}

async function stream<K extends keyof operations>(
  request: Promise<{ response: Response; error?: unknown }>,
  options: Observe,
): Promise<Result<K>> {
  const { response, error } = await request;
  if (!response.ok) throw new Error(errorMessage(error));
  if (!response.body || !response.headers.get("Content-Type")?.includes("text/event-stream"))
    throw new Error("サーバからの応答形式が正しくありません。");
  for await (const event of readEvents(response.body)) {
    if (event.event === "status") options.onStatus?.(event.data as Status);
    if (event.event === "error") throw new Error(errorMessage(event.data));
    if (event.event === "result") {
      if (!event.data || typeof event.data !== "object" || !("data" in event.data))
        throw new Error("結果を読み取れませんでした。");
      return event.data.data as Result<K>;
    }
  }
  throw new Error("結果を受け取る前に接続が終了しました。再取得してください。");
}

export function createAPI(baseUrl: string) {
  const client = createClient<paths>({ baseUrl, credentials: "omit" });
  return {
    async auth() {
      const { data, error } = await client.GET("/auth");
      if (!data) throw new Error(errorMessage(error));
      return data.data;
    },
    courses(sync: Sync, options: Observe = {}) {
      return stream<"listCourses">(
        client.GET("/courses", {
          params: { query: { sync } },
          parseAs: "stream",
          signal: options.signal,
        }),
        options,
      );
    },
    assignments(sync: Sync, options: Observe = {}) {
      return stream<"listAssignments">(
        client.GET("/assignments", {
          params: { query: { sync } },
          parseAs: "stream",
          signal: options.signal,
        }),
        options,
      );
    },
    materials(courseId: string, sync: Sync, options: Observe = {}) {
      return stream<"listMaterials">(
        client.GET("/courses/{courseId}/materials", {
          params: { path: { courseId }, query: { sync } },
          parseAs: "stream",
          signal: options.signal,
        }),
        options,
      );
    },
    detail(materialId: string, sync: Sync, options: Observe = {}) {
      return stream<"getMaterial">(
        client.GET("/materials/{materialId}", {
          params: { path: { materialId }, query: { sync } },
          parseAs: "stream",
          signal: options.signal,
        }),
        options,
      );
    },
    login(options: Observe = {}) {
      return stream<"login">(
        client.POST("/auth/login", {
          body: { interactive: true },
          parseAs: "stream",
          signal: options.signal,
        }),
        options,
      );
    },
    check(options: Observe = {}) {
      return stream<"checkAuthentication">(
        client.POST("/auth/check", { parseAs: "stream", signal: options.signal }),
        options,
      );
    },
    register(options: Observe = {}) {
      return stream<"registerWebAuthn">(
        client.POST("/auth/webauthn", {
          body: { interactive: true },
          parseAs: "stream",
          signal: options.signal,
        }),
        options,
      );
    },
    logout(options: Observe = {}) {
      return stream<"logout">(
        client.DELETE("/auth", { parseAs: "stream", signal: options.signal }),
        options,
      );
    },
    download(materialId: string, resourceId: string, options: Observe = {}) {
      return stream<"downloadResource">(
        client.POST("/materials/{materialId}/resources/{resourceId}/download", {
          params: { path: { materialId, resourceId } },
          parseAs: "stream",
          signal: options.signal,
        }),
        options,
      );
    },
    async file(materialId: string, resourceId: string) {
      const { data, error } = await client.GET(
        "/materials/{materialId}/resources/{resourceId}/file",
        { params: { path: { materialId, resourceId } }, parseAs: "blob" },
      );
      if (!data) throw new Error(errorMessage(error));
      return data;
    },
  };
}

export type API = ReturnType<typeof createAPI>;
