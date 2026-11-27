import type { Meta, StoryObj } from "storybook-solidjs-vite";
import WorkspaceStory, { pageParameters } from "../../../.storybook/WorkspaceStory";
import {
  assignments,
  course,
  createStoryAPI,
  pending,
  unavailable,
} from "../../../.storybook/fixtures";

const meta = {
  title: "Pages/Assignments",
  component: WorkspaceStory,
  parameters: pageParameters,
  args: { path: "/assignments", api: createStoryAPI() },
} satisfies Meta<typeof WorkspaceStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const Empty: Story = {
  args: { api: createStoryAPI({ assignments: async () => ({ assignments: [], failures: [] }) }) },
};
export const Loading: Story = {
  args: {
    api: createStoryAPI({
      assignments: (_sync, observe) => pending(observe, "fetching-materials"),
    }),
  },
};
export const Error: Story = {
  args: { api: createStoryAPI({ assignments: unavailable }) },
};
export const PartialFailure: Story = {
  args: {
    api: createStoryAPI({
      assignments: async () => ({
        ...assignments,
        failures: [
          {
            lmsCourseId: course.lmsCourseId,
            error: { reason: "internal", message: "一部の教材を取得できませんでした。" },
          },
        ],
      }),
    }),
  },
};
export const AllCoursesFailed: Story = {
  args: {
    api: createStoryAPI({
      assignments: async () => ({
        assignments: [],
        failures: [
          {
            lmsCourseId: course.lmsCourseId,
            error: { reason: "authentication-required", message: "認証が必要です。" },
          },
          {
            lmsCourseId: "missing-course",
            error: { reason: "course-not-found", message: "講義が見つかりません。" },
          },
        ],
      }),
    }),
  },
};
