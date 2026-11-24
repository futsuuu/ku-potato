import { action } from "storybook/actions";

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
