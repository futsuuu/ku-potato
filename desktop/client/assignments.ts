import { DateTime } from "effect";
import type { DesktopAssignment } from "../bindings.ts";

export const assignmentDeadline = (assignment: DesktopAssignment): number => {
    const deadline = assignment.material.publicationDeadline;
    if (deadline === "no-deadline" || deadline === "unavailable") return -Infinity;
    return DateTime.toEpochMillis(DateTime.makeUnsafe(deadline));
};

export const upcomingAssignments = (assignments: readonly DesktopAssignment[], now: number) =>
    assignments.filter((assignment) => assignmentDeadline(assignment) > now)
        .sort((a, b) => assignmentDeadline(a) - assignmentDeadline(b));
