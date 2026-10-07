import { DateTime, Effect, Fiber } from "effect";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { CourseListResult } from "../../bindings.ts";
import { assignmentDeadline, upcomingAssignments } from "../assignments.ts";
import { createDesktopQuery, queryErrorMessage } from "../query.ts";
import { paths } from "../router.ts";
import MaterialInfo from "./MaterialInfo.tsx";
import QueryStatus from "./QueryStatus.tsx";

type Courses = Extract<CourseListResult, { status: "success" }>["data"];

export default function UpcomingAssignments(props: { courses: Courses }) {
    const courseIds = () =>
        props.courses.flatMap((course) => course.availability === "available" ? [course.lmsCourseId] : []);
    const query = createDesktopQuery(
        () => JSON.stringify(courseIds()),
        (_, sync) => bindings.listAssignments(courseIds(), sync),
    );
    const [now, setNow] = createSignal(DateTime.toEpochMillis(DateTime.nowUnsafe()));
    const assignments = createMemo(() => upcomingAssignments(query.data()?.assignments ?? [], now()), {
        equals: (previous, next) =>
            previous.length === next.length && previous.every((assignment, index) => assignment === next[index]),
    });
    createEffect(
        () => ({ next: assignments()[0], now: now() }),
        ({ next }) => {
            if (!next) return;
            const delay = Math.max(0, assignmentDeadline(next) - DateTime.toEpochMillis(DateTime.nowUnsafe()));
            // Browser timers use signed 32-bit delays; recheck distant deadlines in chunks.
            const timer = Effect.runFork(
                Effect.sleep(Math.min(delay, 2_147_483_647)).pipe(
                    Effect.andThen(Effect.sync(() => setNow(DateTime.toEpochMillis(DateTime.nowUnsafe())))),
                ),
            );
            return () => {
                Effect.runFork(Fiber.interrupt(timer));
            };
        },
        { name: "assignmentDeadlineTimer" },
    );
    const courseName = (id: string) =>
        props.courses.find((course) => course.availability === "available" && course.lmsCourseId === id)?.name ??
            "講義";

    return (
        <section aria-labelledby="upcoming-assignments">
            <header class="app-header">
                <h2 id="upcoming-assignments">期限前の課題</h2>
                <button class="app-button" type="button" disabled={query.pending()} onClick={query.refresh}>
                    再取得
                </button>
            </header>
            <QueryStatus pending={query.pending()} error={query.error()} />
            <Show when={query.data()}>
                {(data) => (
                    <>
                        <For each={data().failures}>
                            {(failure) => (
                                <p role="alert">
                                    {courseName(failure.lmsCourseId)}: {queryErrorMessage(failure.error)}
                                </p>
                            )}
                        </For>
                        <p>{assignments().length}件（公開期限が近い順）</p>
                        <ul class="app-list">
                            <For
                                each={assignments()}
                                fallback={
                                    <li class="app-row">
                                        {data().failures.length > 0
                                            ? "取得できた講義に期限前の課題はありません。"
                                            : "期限前の課題はありません。"}
                                    </li>
                                }
                            >
                                {(assignment) => (
                                    <li class="app-row">
                                        <span>{assignment.material.name}</span>
                                        <MaterialInfo material={assignment.material}>
                                            {" "}
                                            ·{" "}
                                            <a href={paths.courses(assignment.lmsCourseId)}>
                                                {courseName(assignment.lmsCourseId)}
                                            </a>{" "}
                                            · {assignment.folderName}
                                        </MaterialInfo>
                                    </li>
                                )}
                            </For>
                        </ul>
                    </>
                )}
            </Show>
        </section>
    );
}
