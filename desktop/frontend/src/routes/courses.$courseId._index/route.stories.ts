import type { Meta, StoryObj } from "storybook-solidjs-vite";
import WorkspaceStory, { pageParameters } from "../../../.storybook/WorkspaceStory";
import { createStoryAPI, folders, pending, unavailable } from "../../../.storybook/fixtures";

const meta = {
  title: "Pages/Materials",
  component: WorkspaceStory,
  parameters: pageParameters,
  args: { path: "/courses/course-1", api: createStoryAPI() },
} satisfies Meta<typeof WorkspaceStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const Empty: Story = {
  args: {
    api: createStoryAPI({ materials: async (lmsCourseId) => ({ lmsCourseId, folders: [] }) }),
  },
};
export const Loading: Story = {
  args: {
    api: createStoryAPI({
      materials: (_id, _sync, observe) => pending(observe, "fetching-materials"),
    }),
  },
};
export const Error: Story = {
  args: { api: createStoryAPI({ materials: unavailable }) },
};
export const EmptyFolder: Story = {
  args: {
    api: createStoryAPI({
      materials: async (lmsCourseId) => ({
        lmsCourseId,
        folders: [{ name: "公開前の教材", materials: [] }],
      }),
    }),
  },
};
export const LongContent: Story = {
  args: {
    api: createStoryAPI({
      materials: async (lmsCourseId) => ({
        lmsCourseId,
        folders: folders.map((folder) => ({
          ...folder,
          name: folder.name.repeat(12),
          descriptionHtml: "<p>非常に長い説明文でも教材へのリンクを確認できます。</p>".repeat(20),
          materials: folder.materials.map((material) => ({
            ...material,
            name: material.name.repeat(12),
          })),
        })),
      }),
    }),
  },
};
