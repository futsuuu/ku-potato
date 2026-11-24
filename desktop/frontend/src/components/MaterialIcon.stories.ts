import type { Meta, StoryObj } from "storybook-solidjs-vite";
import MaterialIcon from "./MaterialIcon";

const meta = {
  title: "Materials/MaterialIcon",
  component: MaterialIcon,
  args: { type: "material" },
  argTypes: {
    type: {
      control: "select",
      options: [
        "material",
        "report",
        "test",
        "questionnaire",
        "e-learning",
        "board",
        "feedback",
        "unknown",
      ],
    },
  },
} satisfies Meta<typeof MaterialIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Material: Story = {};
export const Report: Story = { args: { type: "report" } };
export const Test: Story = { args: { type: "test" } };
export const Questionnaire: Story = { args: { type: "questionnaire" } };
export const ELearning: Story = { args: { type: "e-learning" } };
export const Board: Story = { args: { type: "board" } };
export const Feedback: Story = { args: { type: "feedback" } };
export const Unknown: Story = { args: { type: "unknown" } };
