import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { action } from "storybook/actions";
import ConnectionScreen from "./ConnectionScreen";
import WindowFrame from "./WindowFrame";

const meta = {
  title: "Shell/WindowFrame",
  component: WindowFrame,
  parameters: {
    layout: "fullscreen",
    docs: { story: { inline: false, height: "320px" } },
  },
  args: { children: undefined },
  render: () => (
    <WindowFrame>
      <ConnectionScreen pending={true} error="" onReload={action("reload")} />
    </WindowFrame>
  ),
} satisfies Meta<typeof WindowFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Browser: Story = {};
