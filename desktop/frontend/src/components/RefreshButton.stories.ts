import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { action } from "storybook/actions";
import RefreshButton from "./RefreshButton";

const meta = {
  title: "Controls/RefreshButton",
  component: RefreshButton,
  args: { label: "教材を再取得", disabled: false, onClick: action("refresh") },
} satisfies Meta<typeof RefreshButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const LongLabel: Story = {
  args: { label: "教材の一覧と関連するすべての添付資料を再取得します。".repeat(10) },
};
