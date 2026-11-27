import { action } from "storybook/actions";
import type { API, Observe, Result, Schema } from "../src/api";

export const course = {
  name: "情報科学概論",
  lmsCourseId: "course-1",
  academicYear: 2026,
  type: "scheduled",
  weekday: 1,
  period: 2,
  availability: "available",
} satisfies Schema["Course"];

export const courses: Schema["Course"][] = [
  course,
  { ...course, name: "ソフトウェア設計演習", lmsCourseId: "course-2", weekday: 3, period: 3 },
  {
    name: "履修登録前の講義",
    academicYear: 2026,
    type: "scheduled",
    weekday: 5,
    period: 1,
    availability: "unavailable",
  },
  {
    ...course,
    name: "保存済みの特別講義",
    lmsCourseId: "course-archived",
    type: "other",
    archived: true,
  },
  { name: "時間割未確定の講義", academicYear: 2026, type: "unknown", availability: "unavailable" },
];

export const material = {
  lmsMaterialId: "material-1",
  name: "第3回 コンポーネント設計の講義資料",
  type: "material",
  status: "unviewed",
  resourceAvailability: "available",
  materialLinkAvailable: true,
  publicationDeadlineKind: "at",
  publicationDeadlineAt: "2099-12-20T14:59:00Z",
} satisfies Schema["Material"];

export const reportMaterial = {
  lmsMaterialId: "report-1",
  name: "第3回 レポート課題",
  type: "report",
  status: "unsubmitted",
  materialLinkAvailable: true,
  publicationDeadlineKind: "at",
  publicationDeadlineAt: "2099-12-15T14:59:00Z",
} satisfies Schema["Material"];

export const otherMaterials: Schema["Material"][] = [
  {
    ...material,
    lmsMaterialId: "test-1",
    name: "理解度テスト",
    type: "test",
    status: "not-started",
  },
  {
    ...material,
    lmsMaterialId: "questionnaire-1",
    name: "授業アンケート",
    type: "questionnaire",
    status: "answered",
  },
  {
    ...material,
    lmsMaterialId: "learning-1",
    name: "復習教材",
    type: "e-learning",
    status: "unknown",
  },
  { ...material, lmsMaterialId: "board-1", name: "質問掲示板", type: "board", status: "unposted" },
  {
    ...material,
    lmsMaterialId: "feedback-1",
    name: "講評",
    type: "feedback",
    status: "unevaluated",
  },
  {
    ...material,
    lmsMaterialId: "unknown-1",
    name: "種別不明の教材",
    type: "unknown",
    status: "unknown",
  },
];

export const folders: Schema["Folder"][] = [
  {
    name: "第3回 コンポーネント設計",
    classDate: "2026-12-01",
    descriptionHtml:
      '<p>講義資料を確認し、レポートを提出してください。</p><p><a href="https://example.com/guide">学習の進め方</a></p>',
    materials: [material, reportMaterial],
  },
  {
    name: "演習と補足資料",
    descriptionHtml: "<p>各教材の状態を確認できます。</p>",
    materials: otherMaterials,
  },
  {
    name: "過去の取得データ",
    materials: [
      {
        ...material,
        lmsMaterialId: "material-archived",
        name: "公開終了の講義資料",
        archived: true,
        resourceAvailability: "unavailable",
        publicationDeadlineKind: "closed",
        retrievedAt: "2026-10-01T01:00:00Z",
      },
    ],
  },
  { name: "次回の教材", materials: [] },
];

export const savedFile = {
  contentHash: "a".repeat(64),
  originalFilename: "lecture-03.pdf",
  originalSize: 123456,
} satisfies Schema["SavedFile"];

export const resources: Schema["Resource"][] = [
  { lmsResourceId: "file-1", name: "第3回 講義資料.pdf", type: "file", status: "unviewed" },
  {
    lmsResourceId: "file-2",
    name: "保存済みの演習資料.pdf",
    type: "file",
    status: "viewed",
    savedFile,
  },
  {
    lmsResourceId: "external-1",
    name: "授業の参考サイト",
    type: "external",
    status: "unviewed",
    url: "https://example.com/reference",
  },
  {
    lmsResourceId: "drive-1",
    name: "Google Drive の補足資料",
    type: "external",
    status: "viewed",
    url: "https://drive.google.com/file/d/drive_file/view",
    googleDriveFile: { id: "drive_file", savedFile },
  },
  {
    lmsResourceId: "archived-1",
    name: "公開終了・保存済みの資料.pdf",
    type: "file",
    status: "viewed",
    archived: true,
    savedFile,
  },
  {
    lmsResourceId: "unavailable-1",
    name: "公開終了・未保存の資料.pdf",
    type: "file",
    status: "unknown",
    archived: true,
  },
  { lmsResourceId: "unknown-1", name: "未対応の資料", type: "unknown", status: "unknown" },
];

export const report = {
  status: "unsubmitted",
  correctionMode: "unlimited",
  submissionPeriodKind: "at",
  submissionStartsAt: "2026-12-01T00:00:00Z",
  submissionDueAt: "2099-12-15T14:59:00Z",
  promptHtml:
    "<p>講義で学んだ内容をもとに、<strong>コンポーネント設計</strong>について1,000字程度で論じてください。</p><p>提出形式はPDFとします。</p>",
} satisfies Schema["Report"];

export const assignments: Result<"listAssignments"> = {
  assignments: [
    { lmsCourseId: course.lmsCourseId, folderName: folders[0].name, material: reportMaterial },
    { lmsCourseId: "course-2", folderName: "第3回 演習", material: otherMaterials[0] },
  ],
  failures: [],
};

export function pending<T>(options: Observe = {}, stage: Schema["Progress"]["stage"] = "waiting") {
  options.onStatus?.({
    attempt: 1,
    status: "running",
    progress: { stage, completed: 2, total: 5 },
  });
  return new Promise<T>((_resolve, reject) => {
    if (options.signal?.aborted) reject(options.signal.reason);
    else
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
        once: true,
      });
  });
}

export async function unavailable(): Promise<never> {
  throw new Error("サーバーに接続できませんでした。認証状態を確認して再度お試しください。");
}

export function createStoryAPI(overrides: Partial<API> = {}): API {
  return {
    auth: async () => ({ status: "unauthenticated" }),
    login: async () => {
      action("login")();
      return { status: "authenticated" };
    },
    check: async () => {
      action("check")();
      return { status: "unauthenticated" };
    },
    register: async () => {
      action("register")();
      return { registered: true };
    },
    webauthn: async () => ({ registered: false }),
    deleteWebAuthn: async () => {
      action("deleteWebAuthn")();
      return { registered: false };
    },
    google: {
      auth: async () => ({ status: "authenticated" }),
      login: async () => {
        action("google.login")();
        return { status: "authenticated" };
      },
      check: async () => {
        action("google.check")();
        return { status: "authenticated" };
      },
    },
    googleDrive: {
      download: async (url) => {
        action("googleDrive.download")(url);
        return { downloadUrl: "#download", file: savedFile };
      },
      openFile: async (id) => action("googleDrive.openFile")(id),
    },
    courses: async (sync) => {
      action("courses")(sync);
      return courses;
    },
    materials: async (lmsCourseId, sync) => {
      action("materials")(lmsCourseId, sync);
      return { lmsCourseId, folders };
    },
    detail: async (id, sync) => {
      action("detail")(id, sync);
      const selected: Schema["Material"] =
        folders.flatMap((folder) => folder.materials).find((item) => item.lmsMaterialId === id) ??
        material;
      return selected.type === "report"
        ? { course, material: selected, report, resources: [] }
        : {
            course,
            material: selected,
            resources: selected.archived
              ? resources.map((resource) => ({ ...resource, archived: true }))
              : resources,
          };
    },
    assignments: async (sync) => {
      action("assignments")(sync);
      return assignments;
    },
    download: async (materialId, resourceId) => {
      action("download")(materialId, resourceId);
      return { type: "file", downloadUrl: "#download", file: savedFile };
    },
    openResource: async (materialId, resourceId) => action("openResource")(materialId, resourceId),
    ...overrides,
  };
}
