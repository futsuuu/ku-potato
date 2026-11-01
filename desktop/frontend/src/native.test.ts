// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createAPI } from "./api";
import { serverURL } from "./native";

afterEach(() => {
  delete window.go;
  vi.restoreAllMocks();
});

it("uses the native bridge to open saved resources without an HTTP launch request", async () => {
  const open = vi.fn(async () => {});
  window.go = {
    main: {
      App: {
        ServerURL: async () => "http://127.0.0.1:8787",
        OpenResource: open,
      },
    },
  };
  const fetch = vi.spyOn(globalThis, "fetch");
  const api = createAPI(await serverURL());
  await api.openResource("SRY1", "SRS1");
  expect(open).toHaveBeenCalledExactlyOnceWith("SRY1", "SRS1");
  expect(fetch).not.toHaveBeenCalled();
});

it("propagates native launch failures", async () => {
  window.go = {
    main: {
      App: {
        ServerURL: async () => "http://127.0.0.1:8787",
        OpenResource: async () => {
          throw new Error("no default application");
        },
      },
    },
  };
  await expect(createAPI(await serverURL()).openResource("SRY1", "SRS1")).rejects.toThrow(
    "no default application",
  );
});

it("downloads the saved file in a browser without requesting a server launch or local path", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const fetch = vi.spyOn(globalThis, "fetch");
  await createAPI("/api/").openResource("material with spaces", "resource/part");
  expect(click).toHaveBeenCalledOnce();
  const link = click.mock.instances[0] as HTMLAnchorElement;
  expect(link.getAttribute("href")).toBe(
    "/api/materials/material%20with%20spaces/resources/resource%2Fpart/file",
  );
  expect(link.download).toBe("");
  expect(fetch).not.toHaveBeenCalled();
});
