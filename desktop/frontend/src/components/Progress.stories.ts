import type { Meta, StoryObj } from "storybook-solidjs-vite";
import Progress from "./Progress";

const meta = {
  title: "Feedback/Progress",
  component: Progress,
  args: { pending: true, error: "" },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
export const WithCount: Story = {
  args: {
    status: {
      attempt: 1,
      status: "running",
      progress: { stage: "fetching-materials", completed: 3, total: 12 },
    },
  },
};
export const Error: Story = {
  args: { pending: false, error: "教材を取得できませんでした。もう一度お試しください。" },
};
export const Idle: Story = { args: { pending: false } };
export const PendingWithError: Story = {
  args: { error: "前回の取得に失敗しました。再試行しています。" },
};
export const LargeCount: Story = {
  args: {
    status: {
      attempt: 999,
      status: "running",
      progress: { stage: "downloading", completed: 999999999, total: 1000000000 },
    },
  },
};
export const InconsistentCount: Story = {
  args: {
    status: {
      attempt: 1,
      status: "running",
      progress: { stage: "saving", completed: 12, total: 3 },
    },
  },
};
export const UnknownTotal: Story = {
  args: {
    status: {
      attempt: 1,
      status: "running",
      progress: { stage: "downloading", completed: 100, total: 0 },
    },
  },
};
export const LongError: Story = {
  args: {
    pending: false,
    error: "取得に失敗しました: " + "VeryLongErrorDetailWithoutWordBoundaries".repeat(30),
  },
};
