// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { render } from "@solidjs/web";
import { createRouter, hashHistory } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { pageRoutes } from "virtual:file-routes";
import { createAPI, type API, type Schema } from "../api";
import { WorkspaceProvider } from "../workspace";
import Layout from "../Layout";

const course: Schema["Course"] = {
  name: "情報科学",
  lmsCourseId: "C 1",
  availability: "available",
};
const material: Schema["Material"] = {
  name: "講義資料",
  lmsMaterialId: "M 1",
  type: "material",
  status: "unknown",
  publicationDeadline: "no-deadline",
  materialLinkAvailable: true,
};
const reportMaterial: Schema["Material"] = {
  ...material,
  lmsMaterialId: "R 1",
  name: "第1回レポート",
  type: "report",
  status: "unsubmitted",
};
const report: Schema["ReportDetail"] = {
  status: "unsubmitted",
  submissionPeriodKind: "unlisted",
  correctionMode: "unknown",
  promptHtml: "<p>講義の内容をまとめてください。</p>",
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
  courses: vi.fn(async () => [course]),
  assignments: vi.fn(async () => ({ assignments: [], failures: [] })),
  materials: vi.fn(async () => ({
    lmsCourseId: "C 1",
    folders: [{ name: "第1回", materials: [material, reportMaterial] }],
  })),
  detail: vi.fn<API["detail"]>(async (id) =>
    id === reportMaterial.lmsMaterialId
      ? { course, material: reportMaterial, report, resources: [] }
      : { course, material, resources: [] },
  ),
};
let dispose: (() => void) | undefined;
vi.spyOn(window, "scrollTo").mockImplementation(() => {});

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  vi.clearAllMocks();
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
  await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe(expected));
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
});

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
  expect(document.querySelector('.breadcrumbs a[href="/"]')?.textContent).toBe("講義一覧");
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
});

it("loads a deep link from URL parameters without a previous selection", async () => {
  mount("/courses/C%201/materials/M%201");
  await title(material.name);
  expect(api.detail).toHaveBeenCalledWith("M 1", "auto", expect.anything());
  expect(
    [...document.querySelectorAll(".breadcrumbs a")].map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]),
  ).toEqual([
    ["講義一覧", "/"],
    [course.name, "/courses/C%201"],
  ]);
  expect(document.querySelector('.breadcrumbs [aria-current="page"]')?.textContent).toBe(
    material.name,
  );
  expect(document.querySelector(".page-content")?.textContent).not.toContain("へ戻る");
  click('.breadcrumbs a[href="/courses/C%201"]');
  await title(course.name);
  expect(api.materials).toHaveBeenCalledWith("C 1", "auto", expect.anything());
  click('.breadcrumbs a[href="/"]');
  await title("講義一覧");
});

it("uses the fetched course name in breadcrumbs when the course list is empty", async () => {
  api.courses.mockResolvedValueOnce([]);
  mount("/courses/C%201/materials/M%201");
  await title(material.name);
  expect(document.querySelector('.breadcrumbs a[href="/courses/C%201"]')?.textContent).toBe(
    course.name,
  );
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
  expect(document.querySelector(".section-intro")).toBeNull();
});

it("keeps Wails navigation on the root document with hash history", async () => {
  mount("/courses/C%201/materials/M%201", true);
  await title(material.name);
  click('.breadcrumbs a[href="/courses/C%201"]');
  await title(course.name);
  expect(window.location.pathname).toBe("/");
  expect(window.location.hash).toBe("#/courses/C%201");
  click('.breadcrumbs a[href="/"]');
  await title("講義一覧");
  expect(window.location.pathname).toBe("/");
  expect(window.location.hash).toBe("#/");
});

it("routes assignments and unknown URLs through filesystem routes", async () => {
  mount("/assignments");
  await title("期限前の課題");
  expect(api.assignments).toHaveBeenCalled();
  expect(document.querySelector('.breadcrumbs [aria-current="page"]')?.textContent).toBe(
    "期限前の課題",
  );
  dispose?.();
  mount("/missing/page");
  await title("ページが見つかりません");
  expect(document.querySelector(".page-content")?.textContent).not.toContain("へ戻る");
  click('.breadcrumbs a[href="/"]');
  await title("講義一覧");
});
