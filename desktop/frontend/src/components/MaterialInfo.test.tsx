// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { afterEach, expect, it } from "vite-plus/test";
import type { Schema } from "../api";
import MaterialInfo from "./MaterialInfo";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

const material: Schema["Material"] = {
  lmsMaterialId: "M1",
  name: "資料",
  type: "material",
  status: "unknown",
  publicationDeadlineKind: "closed",
  materialLinkAvailable: false,
  resourceAvailability: "unavailable",
  archived: true,
};

it("does not claim historical content for an unfetched private material", () => {
  dispose = render(() => <MaterialInfo material={material} />, document.body);
  expect(document.body.textContent).toContain("現在は非公開");
  expect(document.body.textContent).not.toContain("過去の取得データ");
});

it("shows the acquisition date when private material content was fetched", () => {
  dispose = render(
    () => <MaterialInfo material={{ ...material, retrievedAt: "2026-10-01T01:00:00Z" }} />,
    document.body,
  );
  expect(document.body.textContent).toContain("過去の取得データ: 2026/10/01 10:00取得");
});

it.each(["report", "test", "questionnaire", "e-learning", "board", "feedback", "unknown"] as const)(
  "does not claim acquired content for unsupported %s details, even with a timestamp",
  (type) => {
    dispose = render(
      () => (
        <MaterialInfo
          material={{ ...material, type, status: "unknown", retrievedAt: "2026-10-01T01:00:00Z" }}
        />
      ),
      document.body,
    );
    expect(document.body.textContent).not.toContain("過去の取得データ");
  },
);
