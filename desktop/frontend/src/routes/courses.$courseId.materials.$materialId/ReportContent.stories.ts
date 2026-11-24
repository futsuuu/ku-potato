import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { Schema } from "../../api";
import ReportContent from "./ReportContent";

const report = {
  status: "unsubmitted",
  correctionMode: "unlimited",
  submissionPeriodKind: "at",
  submissionStartsAt: "2026-12-01T00:00:00Z",
  submissionDueAt: "2026-12-20T14:59:00Z",
  promptHtml:
    "<p>講義で学んだ内容をもとに、<strong>コンポーネント設計</strong>について1,000字程度で論じてください。</p><p>提出形式はPDFとします。</p>",
} satisfies Schema["Report"];

const meta = {
  title: "Content/ReportContent",
  component: ReportContent,
  args: { report, archived: false },
} satisfies Meta<typeof ReportContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unsubmitted: Story = {};
export const Submitted: Story = {
  args: { report: { ...report, status: "submitted" } },
};
export const ResubmissionRequired: Story = {
  args: { report: { ...report, status: "resubmission-required" } },
};
export const Archived: Story = {
  args: {
    archived: true,
    report: { ...report, status: "evaluated", retrievedAt: "2026-10-01T01:00:00Z" },
  },
};
export const NoPrompt: Story = {
  args: { report: { ...report, promptHtml: "", submissionPeriodKind: "unlisted" } },
};
export const UnknownStatusAndPeriod: Story = {
  args: {
    report: { ...report, status: "unknown", submissionPeriodKind: "unknown" },
  },
};
export const OpenEndedPeriod: Story = {
  args: {
    report: { ...report, submissionStartsAt: null, submissionDueAt: null },
  },
};
export const LargePrompt: Story = {
  args: {
    report: {
      ...report,
      promptHtml: "<p>提出前にすべての項目を確認してください。</p>".repeat(100),
    },
  },
};
