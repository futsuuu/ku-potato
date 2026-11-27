import type { Meta, StoryObj } from "storybook-solidjs-vite";
import WorkspaceStory, { pageParameters } from "../../../.storybook/WorkspaceStory";
import { createStoryAPI } from "../../../.storybook/fixtures";

const meta = {
  title: "Pages/NotFound",
  component: WorkspaceStory,
  parameters: pageParameters,
  args: { path: "/missing/page", api: createStoryAPI() },
} satisfies Meta<typeof WorkspaceStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
