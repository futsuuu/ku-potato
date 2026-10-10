declare global {
  interface Window {
    go?: {
      main: {
        App: {
          ServerURL(): Promise<string>;
          SaveFile(filename: string, content: string): Promise<boolean>;
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

export async function saveFile(name: string, blob: Blob) {
  if (window.go) {
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result.split(",", 2)[1]);
        else reject(new Error("ファイルを読み取れませんでした。"));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return window.go.main.App.SaveFile(name, content);
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
