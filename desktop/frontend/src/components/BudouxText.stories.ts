import type { Meta, StoryObj } from "storybook-solidjs-vite";
import BudouxText from "./BudouxText";

const meta = {
  title: "Typography/BudouxText",
  component: BudouxText,
  args: { text: "日本語の文章を自然な区切りで折り返して表示します。" },
} satisfies Meta<typeof BudouxText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Japanese: Story = {};
export const LongText: Story = {
  args: {
    text: "情報科学概論の授業資料とレポート課題について、提出期限までに内容を確認してください。長い文章でも読みやすい位置で折り返されます。",
  },
};
export const MixedText: Story = {
  args: { text: "第3回 TypeScript と Solid のコンポーネント設計（2026年度）" },
};
export const Empty: Story = { args: { text: "" } };
export const UnbrokenText: Story = {
  args: { text: "https://example.com/" + "VeryLongPathWithoutWordBoundaries".repeat(30) },
};
export const RepeatedPunctuation: Story = {
  args: { text: "「『（【句読点の多い文章です。！？】）』」".repeat(30) },
};
