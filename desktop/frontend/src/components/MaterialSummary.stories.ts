import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { Schema } from "../api";
import MaterialSummary from "./MaterialSummary";

const material = {
  lmsMaterialId: "material-1",
  name: "第3回 コンポーネント設計の講義資料",
  type: "material",
  status: "unviewed",
  resourceAvailability: "available",
  materialLinkAvailable: true,
  publicationDeadlineKind: "at",
  publicationDeadlineAt: "2026-12-20T14:59:00Z",
} satisfies Schema["Material"];

const meta = {
  title: "Materials/MaterialSummary",
  component: MaterialSummary,
  args: { material },
} satisfies Meta<typeof MaterialSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {};
export const LongName: Story = {
  args: { material: { ...material, name: "長い教材名と補足説明".repeat(40) } },
};
export const EmptyName: Story = {
  args: { material: { ...material, name: "" } },
};
export const UnknownDeadline: Story = {
  args: { material: { ...material, publicationDeadlineKind: "unknown" } },
};
export const ArchivedWithoutTimestamp: Story = {
  args: {
    material: {
      ...material,
      archived: true,
      resourceAvailability: "unavailable",
      publicationDeadlineKind: "closed",
    },
  },
};
export const NoDeadline: Story = {
  args: { material: { ...material, publicationDeadlineKind: "unlisted" } },
};
export const Archived: Story = {
  args: {
    material: {
      ...material,
      archived: true,
      resourceAvailability: "unavailable",
      publicationDeadlineKind: "closed",
      retrievedAt: "2026-10-01T01:00:00Z",
    },
  },
};
export const Unavailable: Story = {
  args: {
    material: {
      ...material,
      resourceAvailability: "unavailable",
      publicationDeadlineKind: "closed",
    },
  },
};
export const Report: Story = {
  args: {
    material: {
      lmsMaterialId: "report-1",
      name: "第3回 レポート課題",
      type: "report",
      status: "unsubmitted",
      materialLinkAvailable: true,
      publicationDeadlineKind: "at",
      publicationDeadlineAt: "2026-12-20T14:59:00Z",
    },
  },
};
