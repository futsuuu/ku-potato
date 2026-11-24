import { createJSXDecorator, type Meta, type StoryObj } from "storybook-solidjs-vite";
import { action } from "storybook/actions";
import { createAPI, type Schema } from "../api";
import ResourceRow from "./ResourceRow";

const resource = {
  lmsResourceId: "resource-1",
  name: "第3回 講義資料.pdf",
  type: "file",
  status: "unviewed",
} satisfies Schema["Resource"];

const file = {
  contentHash: "a".repeat(64),
  originalFilename: "lecture-03.pdf",
  originalSize: 123456,
} satisfies Schema["SavedFile"];

const meta = {
  title: "Materials/ResourceRow",
  component: ResourceRow,
  decorators: [
    createJSXDecorator((Story) => (
      <ul class="item-list">
        <Story />
      </ul>
    )),
  ],
  args: {
    materialId: "material-1",
    resource,
    reload: action("reload"),
    api: {
      ...createAPI("https://storybook.invalid"),
      download: async () => ({
        type: "file" as const,
        downloadUrl: "#download",
        file,
      }),
    },
  },
} satisfies Meta<typeof ResourceRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Downloadable: Story = {};
export const DownloadFailed: Story = {
  parameters: {
    docs: { description: { story: "Click the resource to display a download failure." } },
  },
  args: {
    api: {
      ...meta.args.api,
      download: async () => {
        throw new Error("ダウンロードに失敗しました。");
      },
    },
  },
};
export const Saved: Story = {
  args: { resource: { ...resource, savedFile: file } },
};
export const External: Story = {
  args: {
    resource: {
      ...resource,
      name: "授業の参考サイト",
      type: "external",
      url: "https://example.com/reference",
    },
  },
};
export const Archived: Story = {
  args: { resource: { ...resource, archived: true, savedFile: file } },
};
export const Unavailable: Story = {
  args: { resource: { ...resource, archived: true } },
};
export const Unsupported: Story = {
  args: { resource: { ...resource, type: "unknown", name: "未対応の教材" } },
};
export const NeverCompletes: Story = {
  parameters: {
    docs: {
      description: { story: "Click the resource to keep the download pending indefinitely." },
    },
  },
  args: {
    api: {
      ...meta.args.api,
      download: async () => new Promise(() => {}),
    },
  },
};
export const LongName: Story = {
  args: { resource: { ...resource, name: "非常に長いファイル名の講義資料".repeat(30) + ".pdf" } },
};
export const ArchivedExternalFile: Story = {
  args: {
    resource: {
      ...resource,
      type: "external",
      url: "https://example.com/reference",
      archived: true,
      savedFile: file,
    },
  },
};
