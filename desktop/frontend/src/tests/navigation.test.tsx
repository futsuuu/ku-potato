// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { render } from "@solidjs/web";
import { createRouter, hashHistory } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { pageRoutes } from "virtual:file-routes";
import { createAPI, type API, type Schema } from "../api";
import { WorkspaceProvider } from "../workspace";
import Layout from "../components/Layout";

const course: Schema["Course"] = {
  name: "情報科学",
  lmsCourseId: "C 1",
  academicYear: 2026,
  type: "other",
  availability: "available",
};
const material: Schema["Material"] = {
  name: "講義資料",
  lmsMaterialId: "M 1",
  type: "material",
  resourceAvailability: "available",
  status: "unknown",
  publicationDeadlineKind: "unlisted",
  materialLinkAvailable: true,
};
const reportMaterial: Schema["Material"] = {
  ...material,
  lmsMaterialId: "R 1",
  name: "第1回レポート",
  type: "report",
  status: "unsubmitted",
};
const report: Schema["Report"] = {
  status: "unsubmitted",
  submissionPeriodKind: "unlisted",
  correctionMode: "unknown",
  promptHtml: "<p>講義の内容をまとめてください。</p>",
};
const assignment: Schema["Assignment"] = {
  lmsCourseId: "C 1",
  folderName: "第1回",
  material: {
    ...reportMaterial,
    publicationDeadlineKind: "at",
    publicationDeadlineAt: "2099-12-20T14:59:00Z",
  },
};
const api = {
  ...createAPI("http://localhost"),
  auth: vi.fn(async () => ({ status: "unauthenticated" as const })),
  webauthn: vi.fn(async () => ({ registered: false })),
  google: {
    ...createAPI("http://localhost").google,
    auth: vi.fn(async () => ({ status: "authenticated" as const })),
    check: vi.fn(async () => ({ status: "unauthenticated" as const })),
  },
  courses: vi.fn<API["courses"]>(async () => [course]),
  assignments: vi.fn<API["assignments"]>(async () => ({ assignments: [], failures: [] })),
  materials: vi.fn<API["materials"]>(async () => ({
    lmsCourseId: "C 1",
    folders: [
      {
        name: "第1回",
        descriptionHtml:
          '<p>今週の教材です。</p><a href="https://example.com/guide">案内</a><script>alert(1)</script>',
        materials: [material, reportMaterial],
      },
    ],
  })),
  detail: vi.fn<API["detail"]>(async (id) =>
    id === reportMaterial.lmsMaterialId
      ? { course, material: reportMaterial, report, resources: [] }
      : { course, material, resources: [] },
  ),
};
let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network request")));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(path: string, native = false) {
  window.history.replaceState(null, "", native ? `/#${path}` : path);
  const host = document.createElement("div");
  document.body.append(host);
  const Router = createRouter({
    routes: fileRoutes(pageRoutes),
    history: native ? hashHistory() : undefined,
    scrollRestoration: false,
  });
  dispose = render(
    () => (
      <WorkspaceProvider api={api}>
        <Router>{(props) => <Layout>{props.children}</Layout>}</Router>
      </WorkspaceProvider>
    ),
    host,
  );
}

async function title(expected: string) {
  await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe(expected), {
    timeout: 10000,
  });
}

it("keeps Google and LMS authentication independent across route changes", async () => {
  mount("/");
  await title("講義一覧");
  const google = document.querySelector('section[aria-label="Google（@g.kogakuin.jp）"]');
  const lms = document.querySelector('section[aria-label="工学院 統合認証"]');
  await vi.waitFor(() => expect(google?.textContent).toContain("ログイン済み"));
  expect(lms?.textContent).toContain("未ログイン");
  const check = [...(google?.querySelectorAll("button") ?? [])].find((button) =>
    button.textContent?.includes("認証状態を確認"),
  );
  expect(check).toBeDefined();
  check?.click();
  await vi.waitFor(() => expect(google?.textContent).toContain("未ログイン"));
  expect(api.google.check).toHaveBeenCalledOnce();
  expect(lms?.textContent).toContain("未ログイン");
  document.querySelector<HTMLAnchorElement>('nav a[href="/assignments"]')?.click();
  await title("期限前の課題");
  expect(
    document.querySelector('section[aria-label="Google（@g.kogakuin.jp）"]')?.textContent,
  ).toContain("未ログイン");
  expect(api.google.auth).toHaveBeenCalledOnce();
  expect(api.auth).toHaveBeenCalledOnce();
}, 15000);

function click(selector: string) {
  const link = document.querySelector<HTMLAnchorElement>(selector);
  expect(link).not.toBeNull();
  // Click the row's metadata, outside the title, to exercise its full link area.
  (link?.querySelector<HTMLElement>("small") ?? link)?.click();
}

it("navigates full course/material links and restores browser back/forward", async () => {
  mount("/");
  await title("講義一覧");
  await vi.waitFor(() => expect(document.querySelector(".course-link")).not.toBeNull());
  document.querySelector(".page-content")!.scrollTop = 200;
  click(".course-link");
  await title(course.name);
  expect(document.querySelector(".page-content")?.scrollTop).toBe(0);
  expect(document.querySelector('nav[aria-label="パンくずリスト"] a[href="/"]')?.textContent).toBe(
    "講義一覧",
  );
  expect(window.location.pathname).toBe("/courses/C%201");
  await vi.waitFor(() => expect(document.querySelector("a.item-link")).not.toBeNull());
  click("a.item-link");
  await title(material.name);
  expect(api.detail).toHaveBeenCalledWith("M 1", "auto", expect.anything());
  document.querySelector(".page-content")!.scrollTop = 200;
  window.history.back();
  await title(course.name);
  expect(document.querySelector(".page-content")?.scrollTop).toBe(0);
  document.querySelector(".page-content")!.scrollTop = 200;
  window.history.forward();
  await title(material.name);
  expect(document.querySelector(".page-content")?.scrollTop).toBe(0);
}, 15000);

it("shows a sanitized folder description beneath its name", async () => {
  mount("/courses/C%201");
  await title(course.name);
  await vi.waitFor(() => expect(document.querySelector(".folder-description")).not.toBeNull());
  const heading = document.querySelector(".folder-section > div")!;
  expect(heading.querySelector("h3")?.textContent).toBe("第1回");
  expect(heading.querySelector(".folder-description")?.textContent).toBe("今週の教材です。案内");
  expect(heading.querySelector(".folder-description script")).toBeNull();
});

it("loads a deep link from URL parameters without a previous selection", async () => {
  mount("/courses/C%201/materials/M%201");
  await title(material.name);
  expect(api.detail).toHaveBeenCalledWith("M 1", "auto", expect.anything());
  expect(
    [...document.querySelectorAll('nav[aria-label="パンくずリスト"] a')].map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]),
  ).toEqual([
    ["講義一覧", "/"],
    [course.name, "/courses/C%201"],
  ]);
  expect(
    document.querySelector('nav[aria-label="パンくずリスト"] [aria-current="page"]')?.textContent,
  ).toBe(material.name);
  expect(document.querySelector(".page-content")?.textContent).not.toContain("へ戻る");
  click('nav[aria-label="パンくずリスト"] a[href="/courses/C%201"]');
  await title(course.name);
  expect(api.materials).toHaveBeenCalledWith("C 1", "auto", expect.anything());
  click('nav[aria-label="パンくずリスト"] a[href="/"]');
  await title("講義一覧");
});

it("uses the fetched course name in breadcrumbs when the course list is empty", async () => {
  api.courses.mockResolvedValueOnce([]);
  mount("/courses/C%201/materials/M%201");
  await title(material.name);
  expect(
    document.querySelector('nav[aria-label="パンくずリスト"] a[href="/courses/C%201"]')
      ?.textContent,
  ).toBe(course.name);
});

it("opens a report from the course list and displays its prompt", async () => {
  mount("/courses/C%201");
  await title(course.name);
  const selector = 'a.item-link[href="/courses/C%201/materials/R%201"]';
  await vi.waitFor(() => expect(document.querySelector(selector)).not.toBeNull());
  click(selector);
  await title(reportMaterial.name);
  expect(api.detail).toHaveBeenCalledWith("R 1", "auto", expect.anything());
  expect(document.querySelector(".report-content")?.textContent).toBe(
    "講義の内容をまとめてください。",
  );
  const syncButton = document.querySelector<HTMLButtonElement>(".page-header button");
  expect(syncButton?.getAttribute("aria-label")).toBe("レポートを同期");
  expect(syncButton?.title).toBe("レポートを同期");
  expect(syncButton?.textContent).toBe("");
  await vi.waitFor(() => expect(syncButton?.disabled).toBe(false));
  syncButton?.click();
  await vi.waitFor(() =>
    expect(api.detail).toHaveBeenLastCalledWith("R 1", "true", expect.anything()),
  );
  expect(document.querySelector("h2")?.textContent).toBe("課題内容");
});

it("keeps Wails navigation on the root document with hash history", async () => {
  mount("/courses/C%201/materials/M%201", true);
  await title(material.name);
  click('nav[aria-label="パンくずリスト"] a[href="/courses/C%201"]');
  await title(course.name);
  expect(window.location.pathname).toBe("/");
  expect(window.location.hash).toBe("#/courses/C%201");
  click('nav[aria-label="パンくずリスト"] a[href="/"]');
  await title("講義一覧");
  expect(window.location.pathname).toBe("/");
  expect(window.location.hash).toBe("#/");
});

it("routes assignments and unknown URLs through filesystem routes", async () => {
  mount("/assignments");
  await title("期限前の課題");
  expect(api.assignments).toHaveBeenCalled();
  expect(
    document.querySelector('nav[aria-label="パンくずリスト"] [aria-current="page"]')?.textContent,
  ).toBe("期限前の課題");
  dispose?.();
  mount("/missing/page");
  await title("ページが見つかりません");
  expect(document.querySelector(".page-content")?.textContent).not.toContain("へ戻る");
  click('nav[aria-label="パンくずリスト"] a[href="/"]');
  await title("講義一覧");
});

const pages = [
  { path: "/", request: api.courses, loading: "講義を読み込んでいます。" },
  { path: "/courses/C%201", request: api.materials, loading: "教材を読み込んでいます。" },
  { path: "/assignments", request: api.assignments, loading: "課題を読み込んでいます。" },
  {
    path: "/courses/C%201/materials/M%201",
    request: api.detail,
    loading: "資料を読み込んでいます。",
  },
];

it.each(pages)("displays loading state at $path", async ({ path, request, loading }) => {
  request.mockReturnValueOnce(new Promise<never>(() => {}));
  mount(path);
  await vi.waitFor(() => expect(document.querySelector(".no-content")?.textContent).toBe(loading));
  expect(document.querySelector('.page-content [role="status"]')).not.toBeNull();
  expect(document.querySelector<HTMLButtonElement>(".page-header button")?.disabled).toBe(true);
});

it.each(pages)("displays request failures at $path", async ({ path, request }) => {
  request.mockRejectedValueOnce(new Error("取得に失敗しました。"));
  mount(path);
  await vi.waitFor(() =>
    expect(document.querySelector('.page-content [role="alert"]')?.textContent).toContain(
      "取得に失敗しました。",
    ),
  );
  expect(document.querySelector<HTMLButtonElement>(".page-header button")?.disabled).toBe(false);
});

it.each([
  {
    path: "/",
    prepare: () => api.courses.mockResolvedValueOnce([]),
    expected: "講義がありません。",
  },
  {
    path: "/courses/C%201",
    prepare: () => api.materials.mockResolvedValueOnce({ lmsCourseId: "C 1", folders: [] }),
    expected: "教材がありません。",
  },
  {
    path: "/assignments",
    prepare: () => api.assignments.mockResolvedValueOnce({ assignments: [], failures: [] }),
    expected: "期限前の課題はありません。",
  },
  {
    path: "/courses/C%201/materials/M%201",
    prepare: () => api.detail.mockResolvedValueOnce({ course, material, resources: [] }),
    expected: "資料がありません。",
  },
])("displays empty state at $path", async ({ path, prepare, expected }) => {
  prepare();
  mount(path);
  await vi.waitFor(() => expect(document.querySelector(".no-content")?.textContent).toBe(expected));
  expect(document.querySelector('.page-content [role="status"]')).toBeNull();
});

it("distinguishes empty folders from missing materials", async () => {
  api.materials.mockResolvedValueOnce({
    lmsCourseId: "C 1",
    folders: [{ name: "公開前の教材", materials: [] }],
  });
  mount("/courses/C%201");
  await vi.waitFor(() =>
    expect(document.querySelector(".folder-empty")?.textContent).toBe(
      "このフォルダに教材はありません。",
    ),
  );
  expect(document.querySelector("h3")?.textContent).toBe("公開前の教材");
  expect(document.querySelector(".no-content")).toBeNull();
});

it("distinguishes unfetched archived resources from empty published materials", async () => {
  api.detail.mockResolvedValueOnce({
    course,
    material: { ...material, archived: true },
    resources: [],
  });
  mount("/courses/C%201/materials/M%201");
  await vi.waitFor(() =>
    expect(document.querySelector(".no-content")?.textContent).toBe(
      "過去に取得した資料データがありません。",
    ),
  );
});

it.each([false, true])("explains missing report content with archived=%s", async (archived) => {
  api.detail.mockResolvedValueOnce({
    course,
    material: { ...reportMaterial, archived },
    resources: [],
  });
  mount("/courses/C%201/materials/R%201");
  await title(reportMaterial.name);
  expect(document.querySelector(".no-content")?.textContent).toBe(
    archived
      ? "過去に取得したレポートの内容はありません。"
      : "レポートの内容が取得されていません。",
  );
});

it.each([false, true])(
  "shows course failures alongside assignments: %s",
  async (hasAssignments) => {
    api.assignments.mockResolvedValueOnce({
      assignments: hasAssignments ? [assignment] : [],
      failures: [
        {
          lmsCourseId: "C 1",
          error: { reason: "authentication-required", message: "認証が必要です。" },
        },
      ],
    });
    mount("/assignments");
    await vi.waitFor(() =>
      expect(document.querySelector('.page-content [role="alert"]')?.textContent).toBe(
        `${course.name}: 認証が必要です。`,
      ),
    );
    if (hasAssignments) {
      expect(document.querySelector("a.item-link")?.textContent).toContain(reportMaterial.name);
      expect(document.querySelector(".no-content")).toBeNull();
    } else {
      expect(document.querySelector(".no-content")?.textContent).toBe("期限前の課題はありません。");
    }
  },
);

it("opens report details from upcoming assignments", async () => {
  api.assignments.mockResolvedValueOnce({ assignments: [assignment], failures: [] });
  mount("/assignments");
  await vi.waitFor(() => expect(document.querySelector("a.item-link")).not.toBeNull());
  click("a.item-link");
  await title(reportMaterial.name);
  expect(api.detail).toHaveBeenCalledWith("R 1", "auto", expect.anything());
  expect(document.querySelector(".report-content")?.textContent).toBe(
    "講義の内容をまとめてください。",
  );
});

it.each([
  ["pending", "講義を取得中"],
  ["failed", "同期に失敗しました。"],
] as const)("keeps saved courses visible when syncing is %s", async (outcome, expected) => {
  api.courses.mockResolvedValueOnce([course]);
  if (outcome === "pending") {
    api.courses.mockImplementationOnce((_sync, observe) => {
      observe?.onStatus?.({
        attempt: 1,
        status: "running",
        progress: { stage: "fetching-courses", completed: 0, total: 1 },
      });
      return new Promise(() => {});
    });
  } else {
    api.courses.mockRejectedValueOnce(new Error("同期に失敗しました。"));
  }
  mount("/");
  await vi.waitFor(() => expect(document.querySelector(".course-link")).not.toBeNull());
  const sync = document.querySelector<HTMLButtonElement>(".page-header button")!;
  await vi.waitFor(() => expect(sync.disabled).toBe(false));
  sync.click();
  await vi.waitFor(() =>
    expect(document.querySelector(".page-content")?.textContent).toContain(expected),
  );
  expect(document.querySelector(".course-link")?.textContent).toContain(course.name);
  expect(api.courses).toHaveBeenLastCalledWith("true", expect.anything());
  expect(sync.disabled).toBe(outcome === "pending");
});
