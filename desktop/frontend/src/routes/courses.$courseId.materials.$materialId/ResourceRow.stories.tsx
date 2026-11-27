import { createJSXDecorator, type Meta, type StoryObj } from "storybook-solidjs-vite";
import { action } from "storybook/actions";
import type { Schema } from "../../api";
import { createStoryAPI } from "../../../.storybook/fixtures";
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
      ...createStoryAPI(),
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
export const GoogleDriveFile: Story = {
  args: {
    resource: {
      ...resource,
      type: "external",
      url: "https://drive.google.com/file/d/drive_file/view",
      googleDriveFile: { id: "drive_file" },
    },
  },
};
export const GoogleDriveDownloadFailed: Story = {
  parameters: {
    docs: {
      description: { story: "Click the resource to display a Google Drive download failure." },
    },
  },
  args: {
    ...GoogleDriveFile.args,
    api: {
      ...meta.args.api,
      googleDrive: {
        ...meta.args.api.googleDrive,
        download: async () => {
          throw new Error("Google Drive のダウンロードに失敗しました。");
        },
      },
    },
  },
};
export const OpenFailed: Story = {
  parameters: {
    docs: { description: { story: "Click the saved resource to display a file launch failure." } },
  },
  args: {
    resource: { ...resource, savedFile: file },
    api: {
      ...meta.args.api,
      openResource: async () => {
        throw new Error("保存済みファイルを開けませんでした。");
      },
    },
  },
};
export const ArchivedExternal: Story = {
  args: {
    resource: {
      ...resource,
      archived: true,
      type: "external",
      url: "https://example.com/reference",
    },
  },
};
export const ArchivedGoogleDriveFile: Story = {
  args: {
    resource: {
      ...resource,
      type: "external",
      url: "https://drive.google.com/file/d/drive_file/view",
      archived: true,
      googleDriveFile: { id: "drive_file", savedFile: file },
    },
  },
};
