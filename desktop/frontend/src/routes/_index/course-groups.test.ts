import { expect, it } from "vite-plus/test";
import { groupCourses } from "./course-groups";
import type { Schema } from "../../api";

it("groups weekdays from Monday to Sunday and puts unscheduled courses last", () => {
  const course = (name: string, weekday?: number): Schema["Course"] => ({
    name,
    lmsCourseId: name,
    academicYear: 2026,
    availability: "available",
    ...(weekday === undefined ? { type: "other" } : { type: "scheduled", weekday, period: 1 }),
  });
  expect(
    groupCourses([
      course("その他"),
      course("日曜", 7),
      course("火曜", 2),
      course("月曜A", 1),
      course("月曜B", 1),
    ]).map((group) => ({ label: group.label, names: group.courses.map((value) => value.name) })),
  ).toEqual([
    { label: "月曜日", names: ["月曜A", "月曜B"] },
    { label: "火曜日", names: ["火曜"] },
    { label: "日曜日", names: ["日曜"] },
    { label: "その他", names: ["その他"] },
  ]);
  expect(groupCourses([])).toEqual([]);
});
