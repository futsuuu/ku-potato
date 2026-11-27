import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { action } from "storybook/actions";
import { createStoryAPI, pending, unavailable } from "../../.storybook/fixtures";
import Authentication from "./Authentication";

const meta = {
  title: "Authentication/Authentication",
  component: Authentication,
  args: {
    api: createStoryAPI(),
    title: "工学院 統合認証",
    onLogin: action("onLogin"),
  },
  render: (args) => (
    <div style={{ "max-width": "320px" }}>
      <Authentication {...args}>
        <p class="muted-note">保存済みの講義・教材はログイン前も閲覧できます。</p>
      </Authentication>
    </div>
  ),
} satisfies Meta<typeof Authentication>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unauthenticated: Story = {};
export const Authenticated: Story = {
  args: { api: createStoryAPI({ auth: async () => ({ status: "authenticated" }) }) },
};
export const Unknown: Story = {
  args: { api: createStoryAPI({ auth: async () => ({ status: "unknown" }) }) },
};
export const RegisteredDevice: Story = {
  args: {
    api: createStoryAPI({
      auth: async () => ({ status: "authenticated" }),
      webauthn: async () => ({ registered: true }),
    }),
  },
};
export const Checking: Story = {
  args: { api: createStoryAPI({ auth: () => pending() }) },
};
export const Error: Story = {
  args: { api: createStoryAPI({ auth: unavailable }) },
};
export const LoginPending: Story = {
  parameters: {
    docs: {
      description: { story: "Click the login button to keep authentication pending indefinitely." },
    },
  },
  args: { api: createStoryAPI({ login: (observe) => pending(observe, "authenticating") }) },
};
export const LoginFailed: Story = {
  parameters: {
    docs: { description: { story: "Click the login button to display an authentication error." } },
  },
  args: { api: createStoryAPI({ login: unavailable }) },
};
export const Google: Story = {
  args: { api: createStoryAPI().google, title: "Google（@g.kogakuin.jp）" },
};
export const GoogleUnauthenticated: Story = {
  args: {
    api: { ...createStoryAPI().google, auth: async () => ({ status: "unauthenticated" }) },
    title: "Google（@g.kogakuin.jp）",
  },
};
