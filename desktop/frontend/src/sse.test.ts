import { describe, expect, it } from "vite-plus/test";
import { readEvents } from "./sse";
import { createAPI } from "./api";

function response(text: string) {
  const encoded = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("SSE", () => {
  it("reads fragmented UTF-8, CRLF, comments, and multiline data", async () => {
    const body = response(
      ': keepalive\r\nevent: result\r\ndata: {"data":\r\ndata: "講義一覧"}\r\n\r\n',
    ).body!;
    const events = [];
    for await (const event of readEvents(body)) events.push(event);
    expect(events).toEqual([{ event: "result", data: { data: "講義一覧" } }]);
  });
  it("delivers progress before typed results through the generated client", async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (request) => {
      urls.push((request as Request).url);
      return response(
        'event: status\ndata: {"status":"running","attempt":1}\n\nevent: result\ndata: {"data":[{"lmsCourseId":"KOG1","name":"講義","availability":"available"}]}\n\n',
      );
    };
    try {
      const statuses: string[] = [];
      const courses = await createAPI("http://127.0.0.1:8787").courses("true", {
        onStatus: (value) => statuses.push(value.status),
      });
      expect(statuses).toEqual(["running"]);
      expect(courses?.[0]?.name).toBe("講義");
      expect(urls).toEqual(["http://127.0.0.1:8787/courses?sync=true"]);
    } finally {
      globalThis.fetch = original;
    }
  });
  it("rejects terminal errors and incomplete streams", async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        response(
          'event: error\ndata: {"error":{"reason":"authentication-required","message":"ログインしてください"}}\n\n',
        );
      await expect(createAPI("http://127.0.0.1:8787").courses("true")).rejects.toThrow(
        "ログインしてください",
      );
      globalThis.fetch = async () =>
        response('event: status\ndata: {"status":"running","attempt":1}\n\n');
      await expect(createAPI("http://127.0.0.1:8787").courses("true")).rejects.toThrow(
        "接続が終了",
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
