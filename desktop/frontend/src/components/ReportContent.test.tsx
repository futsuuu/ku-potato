// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { Schema } from "../api";
import ReportContent from "./ReportContent";

const report: Schema["ReportDetail"] = {
  status: "unsubmitted",
  submissionPeriodKind: "at",
  submissionStartsAt: "2026-10-01T01:00:00Z",
  submissionDueAt: "2026-10-12T14:59:00Z",
  correctionMode: "unknown",
  promptHtml: "<p>設問に回答してください。</p><table><tr><td>設問1</td></tr></table>",
};
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("renders report markup, status, and submission dates", () => {
  dispose = render(() => <ReportContent report={report} archived={false} />, document.body);
  expect(document.querySelector(".report-content p")?.textContent).toBe("設問に回答してください。");
  expect(document.querySelector("td")?.textContent).toBe("設問1");
  expect(document.body.textContent).toContain("未提出");
  expect(document.querySelector("dd.tnum")?.textContent).toBe(
    "2026/10/01 10:00 ～ 2026/10/12 23:59",
  );
  expect(document.body.textContent).not.toContain("過去の取得データ");
});

it("strips executable markup and styling while opening safe links externally", async () => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  dispose = render(
    () => (
      <ReportContent
        report={{
          ...report,
          promptHtml:
            '<script>alert(1)</script><p onclick="alert(1)" style="color:red" class="intrusive">課題</p><a href="javascript:alert(1)">危険なリンク</a><a href="https://example.com/report"><span>参考資料</span></a>',
        }}
        archived={false}
      />
    ),
    document.body,
  );
  const content = document.querySelector(".report-content")!;
  expect(content.querySelector("script, [onclick], [style], .intrusive")).toBeNull();
  expect(content.querySelectorAll("a[href]")).toHaveLength(1);
  await vi.waitFor(() => expect(content.querySelectorAll("a[href] svg.icon")).toHaveLength(1));
  expect(content.querySelectorAll("[class]")).toHaveLength(1);
  content.querySelector<HTMLSpanElement>("a[href] span")!.click();
  expect(open).toHaveBeenCalledWith("https://example.com/report", "_blank", "noopener,noreferrer");
  open.mockClear();
  content
    .querySelector("a[href] svg")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(open).toHaveBeenCalledWith("https://example.com/report", "_blank", "noopener,noreferrer");
});

it("does not label an unfetched report as historical content", () => {
  dispose = render(() => <ReportContent report={report} archived />, document.body);
  expect(document.body.textContent).not.toContain("過去の取得データ");
});

it("shows the report's own acquisition date for archived content", () => {
  dispose = render(
    () => <ReportContent report={{ ...report, retrievedAt: "2026-10-02T01:00:00Z" }} archived />,
    document.body,
  );
  expect(document.body.textContent).toContain("過去の取得データ: 2026/10/02 10:00取得");
});

it("handles a missing prompt and an unlisted submission period", () => {
  dispose = render(
    () => (
      <ReportContent
        report={{ ...report, promptHtml: undefined, submissionPeriodKind: "unlisted" }}
        archived={false}
      />
    ),
    document.body,
  );
  expect(document.body.textContent).toContain("課題文はありません。");
  expect(document.querySelector("dd.tnum")?.textContent).toBe("指定なし");
});
