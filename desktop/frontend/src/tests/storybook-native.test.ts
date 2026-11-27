import { expect, it, vi } from "vite-plus/test";
import { createAPI } from "../api";
import { isDesktop, isWindowsDesktop, openExternal } from "../native";

const { record } = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("storybook/actions", () => ({
  action:
    (name: string) =>
    (...args: unknown[]) =>
      record(name, ...args),
}));
vi.mock("../native", () => import("../../.storybook/native"));

it("routes resource launches through the Storybook native replacement", async () => {
  expect(isDesktop()).toBe(false);
  expect(isWindowsDesktop()).toBe(false);
  const baseUrl = "https://storybook.invalid";
  const api = createAPI(baseUrl);
  await api.googleDrive.openFile("drive_file-123");
  await api.openResource("MAT1", "SRS1");
  await openExternal("https://example.com");
  expect(record.mock.calls).toEqual([
    ["openGoogleDriveFile", baseUrl, "drive_file-123"],
    ["openResource", baseUrl, "MAT1", "SRS1"],
    ["openExternal", "https://example.com"],
  ]);
});
