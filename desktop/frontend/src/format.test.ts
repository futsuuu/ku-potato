import { expect, it } from "vite-plus/test";
import { upcoming } from "./format";
import type { Schema } from "./api";

it("orders future deadlines and excludes expired dates and non-date states", () => {
  const assignment = (deadline: Schema["Deadline"]): Schema["Assignment"] => ({
    lmsCourseId: "KOG1",
    folderName: "Assignment",
    material: {
      lmsMaterialId: "M1",
      name: "Assignment",
      type: "report",
      status: "unknown",
      ...deadline,
      materialLinkAvailable: false,
    },
  });
  const deadlines: Schema["Deadline"][] = [
    { publicationDeadlineKind: "unlisted" },
    { publicationDeadlineKind: "closed" },
    { publicationDeadlineKind: "unknown" },
    { publicationDeadlineKind: "at", publicationDeadlineAt: "2026-10-12T15:00:00Z" },
    { publicationDeadlineKind: "at", publicationDeadlineAt: "2026-10-10T15:00:00Z" },
    { publicationDeadlineKind: "at", publicationDeadlineAt: "2026-10-01T00:00:00Z" },
  ];
  const values = deadlines.map(assignment);
  const archived = assignment({
    publicationDeadlineKind: "at",
    publicationDeadlineAt: "2026-10-11T15:00:00Z",
  });
  values.push({ ...archived, material: { ...archived.material, archived: true } });
  expect(
    upcoming(values, Date.parse("2026-10-10T00:00:00Z")).map(
      ({ material }) => material.publicationDeadlineKind === "at" && material.publicationDeadlineAt,
    ),
  ).toEqual(["2026-10-10T15:00:00Z", "2026-10-12T15:00:00Z"]);
});
