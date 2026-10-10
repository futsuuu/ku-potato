export interface ServerEvent {
  event: string;
  data: unknown;
}

export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let index: number;
      while ((index = buffer.search(/[\r\n]/)) >= 0) {
        if (!chunk.done && buffer[index] === "\r" && index === buffer.length - 1) break;
        const line = buffer.slice(0, index);
        const width = buffer.slice(index, index + 2) === "\r\n" ? 2 : 1;
        buffer = buffer.slice(index + width);
        if (line === "") {
          if (data.length > 0) yield { event, data: JSON.parse(data.join("\n")) as unknown };
          event = "message";
          data = [];
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "event") event = value;
          if (field === "data") data.push(value);
        }
      }
      if (chunk.done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
