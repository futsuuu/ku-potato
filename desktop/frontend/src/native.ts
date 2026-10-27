declare global {
  interface Window {
    go?: {
      main: {
        App: {
          ServerURL(): Promise<string>;
        };
      };
    };
    runtime?: { BrowserOpenURL(url: string): void };
  }
}

export async function serverURL() {
  return window.go
    ? window.go.main.App.ServerURL()
    : import.meta.env.DEV
      ? "/api"
      : "http://127.0.0.1:8787";
}

export function openExternal(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("このリンクは開けません。");
  if (window.runtime) window.runtime.BrowserOpenURL(parsed.href);
  else window.open(parsed.href, "_blank", "noopener,noreferrer");
}
