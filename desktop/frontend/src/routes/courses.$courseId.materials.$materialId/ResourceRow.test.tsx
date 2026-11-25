// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createAPI, type API, type Schema } from "../../api";
import ResourceRow from "./ResourceRow";

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock("../../native", () => ({ openExternal }));

const savedFile: Schema["SavedFile"] = {
  contentHash: "a".repeat(64),
  originalFilename: "handout.pdf",
  originalSize: 3,
};
const base: Schema["Resource"] = {
  lmsResourceId: "SRS1",
  name: "Handout",
  type: "external",
  status: "unknown",
  archived: false,
  url: "https://example.com/handout",
};
const drive: Schema["Resource"] = {
  ...base,
  url: "https://drive.google.com/file/d/drive_file/view",
  googleDriveFile: { id: "drive_file" },
};
const api = {
  ...createAPI("/api"),
  download: vi.fn<API["download"]>(async () => ({
    type: "file",
    file: savedFile,
    downloadUrl: "/file",
  })),
  openResource: vi.fn<API["openResource"]>(async () => {}),
  googleDrive: {
    download: vi.fn<API["googleDrive"]["download"]>(async () => ({
      file: savedFile,
      downloadUrl: "/google-drive/files/drive_file/file",
    })),
    openFile: vi.fn<API["googleDrive"]["openFile"]>(async () => {}),
  },
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

it("downloads and opens an unsaved LMS file with the default application", async () => {
  mount({ ...base, type: "file", url: undefined });
  click("Handout");
  await vi.waitFor(() => expect(api.openResource).toHaveBeenCalledWith("SRY1", "SRS1"));
  expect(api.download).toHaveBeenCalledOnce();
  expect(api.googleDrive.download).not.toHaveBeenCalled();
  expect(reload).toHaveBeenCalledOnce();
});

it("opens a saved Google Drive file with separate link and redownload actions", async () => {
  mount({ ...drive, googleDriveFile: { id: "drive_file", savedFile } });
  click("Handout");
  await vi.waitFor(() => expect(api.googleDrive.openFile).toHaveBeenCalledWith("drive_file"));
  expect(api.openResource).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(
      [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("リンクを開く"))
        ?.disabled,
    ).toBe(false),
  );
  click("リンクを開く");
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(drive.url));
  await vi.waitFor(() =>
    expect(
      [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("再ダウンロード"),
      )?.disabled,
    ).toBe(false),
  );
  click("再ダウンロード");
  await vi.waitFor(() =>
    expect(api.googleDrive.download).toHaveBeenCalledWith(drive.url, expect.anything()),
  );
  expect(api.googleDrive.openFile).toHaveBeenCalledOnce();
  expect(api.download).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
});

it("opens ordinary external links without downloading through either provider", async () => {
  mount(base);
  click("Handout");
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(base.url));
  expect(api.openResource).not.toHaveBeenCalled();
  expect(api.download).not.toHaveBeenCalled();
  expect(api.googleDrive.download).not.toHaveBeenCalled();
});

it("shows Google Drive failures without losing the saved file", async () => {
  api.googleDrive.download.mockRejectedValueOnce(new Error("download failed"));
  mount({ ...drive, googleDriveFile: { id: "drive_file", savedFile } });
  click("再ダウンロード");
  await vi.waitFor(() => expect(document.body.textContent).toContain("download failed"));
  expect(api.googleDrive.openFile).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  click("Handout");
  await vi.waitFor(() => expect(api.googleDrive.openFile).toHaveBeenCalledWith("drive_file"));
});

it.each([false, true])(
  "downloads Google Drive files independently of LMS archival: %s",
  async (archived) => {
    mount({ ...drive, archived });
    click("Handout");
    await vi.waitFor(() => expect(api.googleDrive.openFile).toHaveBeenCalledWith("drive_file"));
    expect(api.googleDrive.download).toHaveBeenCalledWith(drive.url, expect.anything());
    expect(api.download).not.toHaveBeenCalled();
    expect(api.openResource).not.toHaveBeenCalled();
  },
);

it("opens archived saved Google Drive files without downloading", async () => {
  mount({ ...drive, archived: true, googleDriveFile: { id: "drive_file", savedFile } });
  click("Handout");
  await vi.waitFor(() => expect(api.googleDrive.openFile).toHaveBeenCalledWith("drive_file"));
  expect(api.googleDrive.download).not.toHaveBeenCalled();
  expect(api.download).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(
      [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("再ダウンロード"),
      )?.disabled,
    ).toBe(false),
  );
  click("再ダウンロード");
  await vi.waitFor(() => expect(api.googleDrive.download).toHaveBeenCalledOnce());
  expect(api.download).not.toHaveBeenCalled();
});

it("opens archived saved LMS files without contacting the LMS", async () => {
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
