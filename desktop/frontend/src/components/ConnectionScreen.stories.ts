import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { action } from "storybook/actions";
import ConnectionScreen from "./ConnectionScreen";

const meta = {
  title: "Shell/ConnectionScreen",
  component: ConnectionScreen,
  parameters: { layout: "fullscreen" },
  args: { pending: true, error: "", onReload: action("reload") },
} satisfies Meta<typeof ConnectionScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connecting: Story = {};
export const Error: Story = {
  args: { pending: false, error: "サーバーに接続できませんでした。" },
};
export const LongError: Story = {
  args: {
    pending: false,
    error: "サーバーへの接続に失敗しました: " + "ConnectionRefused".repeat(30),
  },
};
