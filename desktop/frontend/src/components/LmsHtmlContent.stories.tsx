import type { Meta, StoryObj } from "storybook-solidjs-vite";
import LmsHtmlContent from "./LmsHtmlContent";

const meta = {
  title: "Content/LmsHtmlContent",
  component: LmsHtmlContent,
  args: {
    kind: "report",
    html: "<h3>今回の課題</h3><p>講義資料を読み、<strong>コンポーネントの責務</strong>についてまとめてください。</p><ul><li>設計方針を説明する</li><li>実装例を示す</li></ul><p><a href='https://example.com/reference'>参考資料</a></p>",
  },
} satisfies Meta<typeof LmsHtmlContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Report: Story = {};
export const Folder: Story = {
  args: {
    kind: "folder",
    html: "第3回の講義資料です。<br><br><br>授業前に目を通してください。<br><a href='https://example.com/reference'>補足資料</a>",
  },
};
export const TableAndCode: Story = {
  args: {
    html: "<table><thead><tr><th>項目</th><th>内容</th></tr></thead><tbody><tr><td>提出形式</td><td>PDF</td></tr><tr><td>文字数</td><td>1,000字程度</td></tr></tbody></table><pre><code>const total = items.length;</code></pre>",
  },
};
export const Empty: Story = {
  args: { html: "", fallback: <p class="no-content">内容はありません。</p> },
};
export const WideTable: Story = {
  args: {
    html:
      "<table><tbody><tr>" +
      "<td>非常に長い表の見出しと説明</td>".repeat(20) +
      "</tr></tbody></table>",
  },
};
export const UnbrokenContent: Story = {
  args: {
    html: "<pre><code>" + "VeryLongCodeWithoutAnyWordBoundaries".repeat(50) + "</code></pre>",
  },
};
export const ExcessiveFolderSpacing: Story = {
  args: {
    kind: "folder",
    html: "資料の説明です。" + "<br>".repeat(100) + "末尾の注意事項です。",
  },
};
