import { createJSXDecorator, type Meta, type StoryObj } from "storybook-solidjs-vite";
import { action } from "storybook/actions";
import PageHeader from "./PageHeader";
import RefreshButton from "./RefreshButton";

const meta = {
  title: "Navigation/PageHeader",
  component: PageHeader,
  parameters: {
    layout: "fullscreen",
    docs: { story: { inline: false, height: "320px" } },
  },
  decorators: [
    createJSXDecorator((Story) => (
      <main class="main-content" style={{ "--app-sidebar-width": "0px", height: "100dvh" }}>
        <Story />
        <div class="page-content">
          <p class="muted-note">ページのコンテンツがここに表示されます。</p>
        </div>
      </main>
    )),
  ],
  args: { title: "教材一覧" },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Breadcrumbs: Story = {
  args: {
    title: "第3回 コンポーネント設計",
    ancestors: [
      { label: "授業一覧", href: "#courses" },
      { label: "情報科学概論", href: "#course" },
    ],
  },
};
export const WithActions: Story = {
  args: { ...Breadcrumbs.args },
  render: (args) => (
    <PageHeader {...args}>
      <RefreshButton label="教材を再取得" disabled={false} onClick={action("refresh")} />
    </PageHeader>
  ),
};
export const LongTitle: Story = {
  args: {
    ...Breadcrumbs.args,
    title: "第3回 コンポーネント設計と状態管理についての講義資料および演習課題の詳細",
  },
};
export const ManyAncestors: Story = {
  args: {
    title: "最下層の教材",
    ancestors: Array.from({ length: 12 }, (_, index) => ({
      label: `第${index + 1}階層の非常に長いフォルダー名`,
      href: `#folder-${index}`,
    })),
  },
};
export const UnbrokenTitle: Story = {
  args: { title: "VeryLongMaterialTitleWithoutAnyWordBoundaries".repeat(20) },
};
export const EmptyTitle: Story = { args: { title: "" } };
