// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createAPI, type API, type Schema } from "../api";
import ResourceRow from "./ResourceRow";

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock("../native", () => ({ openExternal }));

const savedFile: Schema["SavedFile"] = {
  contentHash: "a".repeat(64),
  originalFilename: "handout.pdf",
  originalSize: 3,
};
const base: Schema["Resource"] = {
  lmsResourceId: "SRS1",
  name: "Handout",
  type: "external",
  archived: false,
  url: "https://example.com/handout",
};
const api = {
  ...createAPI("/api"),
  download: vi.fn<API["download"]>(async () => ({
    type: "file",
    file: savedFile,
    downloadUrl: "/file",
  })),
  openResource: vi.fn<API["openResource"]>(async () => {}),
};
const reload = vi.fn();
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

function mount(resource: Schema["Resource"]) {
  dispose = render(
    () => <ResourceRow api={api} materialId="SRY1" resource={resource} reload={reload} />,
    document.body,
  );
}
function click(label: string) {
  const button = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label),
  );
  expect(button).toBeDefined();
  button!.click();
}

it("downloads and opens an unsaved file with the default application", async () => {
  mount({ ...base, type: "file", url: undefined });
  click("Handout");
  await vi.waitFor(() => expect(api.openResource).toHaveBeenCalledWith("SRY1", "SRS1"));
  expect(api.download).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledOnce();
});

it("opens a saved external file by default, with separate link and redownload actions", async () => {
  mount({ ...base, savedFile });
  click("Handout");
  await vi.waitFor(() => expect(api.openResource).toHaveBeenCalledWith("SRY1", "SRS1"));
  expect(api.download).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(
      [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("リンクを開く"))
        ?.disabled,
    ).toBe(false),
  );
  click("リンクを開く");
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(base.url));
  await vi.waitFor(() =>
    expect(
      [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("再ダウンロード"),
      )?.disabled,
    ).toBe(false),
  );
  click("再ダウンロード");
  await vi.waitFor(() => expect(api.download).toHaveBeenCalledOnce());
  expect(api.openResource).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
});

it("opens the URL when an external resource cannot be downloaded", async () => {
  api.download.mockResolvedValueOnce({ type: "external", url: base.url! });
  mount(base);
  click("Handout");
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(base.url));
  expect(api.openResource).not.toHaveBeenCalled();
});

it("shows download failures through the current operation without losing the saved file", async () => {
  api.download.mockRejectedValueOnce(new Error("download failed"));
  mount({ ...base, savedFile });
  click("再ダウンロード");
  await vi.waitFor(() => expect(document.body.textContent).toContain("download failed"));
  expect(api.openResource).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  click("Handout");
  await vi.waitFor(() => expect(api.openResource).toHaveBeenCalledWith("SRY1", "SRS1"));
});

it("opens archived saved files without contacting the LMS", async () => {
  mount({ ...base, type: "file", url: undefined, savedFile, archived: true });
  click("Handout");
  await vi.waitFor(() => expect(api.openResource).toHaveBeenCalledWith("SRY1", "SRS1"));
  expect(api.download).not.toHaveBeenCalled();
});

it("opens an archived external link without attempting to download", async () => {
  mount({ ...base, archived: true });
  click("Handout");
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(base.url));
  expect(api.download).not.toHaveBeenCalled();
});
