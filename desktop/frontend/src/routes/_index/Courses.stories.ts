import type { Meta, StoryObj } from "storybook-solidjs-vite";
import WorkspaceStory, { pageParameters } from "../../../.storybook/WorkspaceStory";
import { courses, createStoryAPI, pending, unavailable } from "../../../.storybook/fixtures";

const meta = {
  title: "Pages/Courses",
  component: WorkspaceStory,
  parameters: pageParameters,
  args: { path: "/", api: createStoryAPI() },
} satisfies Meta<typeof WorkspaceStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const Empty: Story = {
  args: { api: createStoryAPI({ courses: async () => [] }) },
};
export const Loading: Story = {
  args: {
    api: createStoryAPI({ courses: (_sync, observe) => pending(observe, "fetching-courses") }),
  },
};
export const Error: Story = {
  args: { api: createStoryAPI({ courses: unavailable }) },
};
export const Refreshing: Story = {
  parameters: {
    docs: {
      description: {
        story: "Click the sync button to keep the saved courses visible while syncing.",
      },
    },
  },
  args: {
    api: createStoryAPI({
      courses: async (sync, observe) =>
        sync === "true" ? pending(observe, "fetching-courses") : courses,
    }),
  },
};
export const RefreshFailed: Story = {
  parameters: {
    docs: {
      description: {
        story: "Click the sync button to display an error alongside the saved courses.",
      },
    },
  },
  args: {
    api: createStoryAPI({
      courses: async (sync) => (sync === "true" ? unavailable() : courses),
    }),
  },
};
export const LongNames: Story = {
  args: {
    api: createStoryAPI({
      courses: async () => courses.map((course) => ({ ...course, name: course.name.repeat(15) })),
    }),
  },
};
