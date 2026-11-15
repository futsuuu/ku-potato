import type { Schema } from "./api";

const weekdays = ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"];

export function groupCourses(courses: Schema["Course"][]) {
  const groups = weekdays.map((label, index) => ({
    label,
    courses: courses.filter(
      (course) => course.type === "scheduled" && course.weekday === index + 1,
    ),
  }));
  groups.push({
    label: "その他",
    courses: courses.filter((course) => course.type !== "scheduled"),
  });
  return groups.filter((group) => group.courses.length > 0);
}
