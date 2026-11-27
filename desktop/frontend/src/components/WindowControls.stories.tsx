import { createJSXDecorator, type Meta, type StoryObj } from "storybook-solidjs-vite";
import { action } from "storybook/actions";
import ConnectionScreen from "./ConnectionScreen";
import WindowControls from "./WindowControls";
import WindowFrame from "./WindowFrame";

const meta = {
  title: "Shell/WindowControls",
  component: WindowControls,
  parameters: {
    layout: "fullscreen",
    docs: {
      story: { inline: false, height: "320px" },
      description: {
        component:
          "Caption glyphs use the system Segoe font and require Windows. Actions are logged without calling the native runtime.",
      },
    },
  },
  decorators: [
    createJSXDecorator((Story) => (
      <div class="windows-window">
        <WindowFrame>
          <Story />
          <ConnectionScreen pending={true} error="" onReload={action("reload")} />
        </WindowFrame>
      </div>
    )),
  ],
  args: {
    maximized: false,
    error: "",
    onMinimize: action("minimize"),
    onToggleMaximize: action("toggleMaximize"),
    onClose: action("close"),
  },
} satisfies Meta<typeof WindowControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Restored: Story = {};
export const Maximized: Story = { args: { maximized: true } };
export const Error: Story = { args: { error: "ウィンドウを操作できませんでした。" } };
