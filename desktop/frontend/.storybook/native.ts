import { action } from "storybook/actions";

export const isDesktop = () => false;
export const isWindowsDesktop = () => false;

export async function openExternal(url: string): Promise<void> {
  action("openExternal")(url);
}

export async function openResource(
  baseUrl: string,
  materialId: string,
  resourceId: string,
): Promise<void> {
  action("openResource")(baseUrl, materialId, resourceId);
}

export async function openGoogleDriveFile(baseUrl: string, fileId: string): Promise<void> {
  action("openGoogleDriveFile")(baseUrl, fileId);
}
