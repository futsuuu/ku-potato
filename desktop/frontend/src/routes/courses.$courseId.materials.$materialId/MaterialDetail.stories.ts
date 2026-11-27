import type { Meta, StoryObj } from "storybook-solidjs-vite";
import WorkspaceStory, { pageParameters } from "../../../.storybook/WorkspaceStory";
import {
  course,
  createStoryAPI,
  material,
  pending,
  report,
  reportMaterial,
  resources,
  unavailable,
} from "../../../.storybook/fixtures";

const meta = {
  title: "Pages/MaterialDetail",
  component: WorkspaceStory,
  parameters: pageParameters,
  args: { path: "/courses/course-1/materials/material-1", api: createStoryAPI() },
} satisfies Meta<typeof WorkspaceStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Resources: Story = {};
export const Empty: Story = {
  args: { api: createStoryAPI({ detail: async () => ({ course, material, resources: [] }) }) },
};
export const Loading: Story = {
  args: {
    api: createStoryAPI({
      detail: (_id, _sync, observe) => pending(observe, "fetching-resources"),
    }),
  },
};
export const Error: Story = {
  args: { api: createStoryAPI({ detail: unavailable }) },
};
export const Archived: Story = {
  args: {
    api: createStoryAPI({
      detail: async () => ({
        course,
        material: {
          ...material,
          archived: true,
          resourceAvailability: "unavailable",
          retrievedAt: "2026-10-01T01:00:00Z",
        },
        resources: resources.map((resource) => ({ ...resource, archived: true })),
      }),
    }),
  },
};
export const ArchivedWithoutResources: Story = {
  args: {
    api: createStoryAPI({
      detail: async () => ({ course, material: { ...material, archived: true }, resources: [] }),
    }),
  },
};
export const Report: Story = {
  args: { path: "/courses/course-1/materials/report-1" },
};
export const ReportNotRetrieved: Story = {
  args: {
    path: "/courses/course-1/materials/report-1",
    api: createStoryAPI({
      detail: async () => ({ course, material: reportMaterial, resources: [] }),
    }),
  },
};
export const ArchivedReport: Story = {
  args: {
    path: "/courses/course-1/materials/report-1",
    api: createStoryAPI({
      detail: async () => ({
        course,
        material: { ...reportMaterial, archived: true },
        report: { ...report, status: "evaluated", retrievedAt: "2026-10-01T01:00:00Z" },
        resources: [],
      }),
    }),
  },
};
export const ArchivedReportNotRetrieved: Story = {
  args: {
    path: "/courses/course-1/materials/report-1",
    api: createStoryAPI({
      detail: async () => ({
        course,
        material: { ...reportMaterial, archived: true },
        resources: [],
      }),
    }),
  },
};
