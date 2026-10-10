import { expect, it } from "vite-plus/test";
import { upcoming } from "./format";
import type { Schema } from "./api";

it("orders future deadlines and excludes expired and sentinel values", () => {
  const assignment = (deadline: string): Schema["Assignment"] => ({
    lmsCourseId: "KOG1",
    folderName: "課題",
    material: { lmsMaterialId: "M1", name: "課題", type: "report", publicationDeadline: deadline },
  });
  const values = [
    "no-deadline",
    "unavailable",
    "2026-10-12T15:00:00Z",
    "2026-10-10T15:00:00Z",
    "2026-10-01T00:00:00Z",
  ].map(assignment);
  values.push({
    ...assignment("2026-10-11T15:00:00Z"),
    material: {
      ...assignment("2026-10-11T15:00:00Z").material,
      archived: true,
    },
  });
  expect(
    upcoming(values, Date.parse("2026-10-10T00:00:00Z")).map(
      (value) => value.material.publicationDeadline,
    ),
  ).toEqual(["2026-10-10T15:00:00Z", "2026-10-12T15:00:00Z"]);
});
