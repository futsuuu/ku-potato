declare global {
  interface Window {
    _wails?: { environment?: unknown };
    chrome?: { webview?: { postMessage?: (message: unknown) => void } };
    webkit?: { messageHandlers?: { external?: { postMessage?: (message: unknown) => void } } };
  }
}

export function isDesktop() {
  // WebView2 injects environment after navigation completes, which can be after App starts.
  return (
    typeof window !== "undefined" &&
    Boolean(
      window._wails?.environment ||
      window.chrome?.webview?.postMessage ||
      window.webkit?.messageHandlers?.external?.postMessage,
    )
  );
}

export async function serverURL() {
  if (isDesktop()) {
    const { ServerURL } = await import("../bindings/github.com/futsuuu/ku-potato/desktop/app");
    return ServerURL();
  }
  return import.meta.env.DEV ? "/api" : "http://127.0.0.1:8787";
}

export async function openResource(baseUrl: string, materialId: string, resourceId: string) {
  if (isDesktop()) {
    const { OpenResource } = await import("../bindings/github.com/futsuuu/ku-potato/desktop/app");
    await OpenResource(materialId, resourceId);
    return;
  }
  const link = document.createElement("a");
  link.href = `${baseUrl.replace(/\/$/, "")}/materials/${encodeURIComponent(materialId)}/resources/${encodeURIComponent(resourceId)}/file`;
  link.download = "";
  link.click();
}

export async function openExternal(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("このリンクは開けません。");
  if (isDesktop()) {
    const { Browser } = await import("@wailsio/runtime");
    await Browser.OpenURL(parsed.href);
  } else {
    window.open(parsed.href, "_blank", "noopener,noreferrer");
  }
}
