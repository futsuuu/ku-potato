import { createJSXDecorator, type Meta, type StoryObj } from "storybook-solidjs-vite";
import LoadingPage from "./LoadingPage";

const meta = {
  title: "Pages/Loading",
  component: LoadingPage,
  parameters: {
    layout: "fullscreen",
    docs: { story: { inline: false, height: "320px" } },
  },
  decorators: [
    createJSXDecorator((Story) => (
      <main class="main-content" style={{ "--app-sidebar-width": "0px", height: "100dvh" }}>
        <Story />
      </main>
    )),
  ],
} satisfies Meta<typeof LoadingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
