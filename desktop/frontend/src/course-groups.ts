import type { Schema } from "./api";

const weekdays = ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"];

export function groupCourses(courses: Schema["Course"][]) {
  const groups = weekdays.map((label, index) => ({
    label,
    courses: courses.filter((course) => course.weekday === index + 1),
  }));
  groups.push({
    label: "その他",
    courses: courses.filter(
      (course) =>
        !Number.isInteger(course.weekday) || (course.weekday ?? 0) < 1 || (course.weekday ?? 0) > 7,
    ),
  });
  return groups.filter((group) => group.courses.length > 0);
}
