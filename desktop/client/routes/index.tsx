import { Title } from "@solidjs/meta";
import { For, Show } from "solid-js";
import QueryStatus from "../components/QueryStatus.tsx";
import UpcomingAssignments from "../components/UpcomingAssignments.tsx";
import { createDesktopQuery } from "../query.ts";
import { paths } from "../router.ts";

export default function Courses() {
    const query = createDesktopQuery(() => "courses", (_, sync) => bindings.listCourses(sync));
    return (
        <>
            <Title>講義・課題一覧 | KU-POTATO</Title>
            <h1 class="sr-only">講義・課題一覧</h1>
            <Show when={query.data()}>
                {(courses) => <UpcomingAssignments courses={courses()} />}
            </Show>
            <header class="app-header">
                <h2>講義一覧</h2>
                <button class="app-button" type="button" disabled={query.pending()} onClick={query.refresh}>
                    再取得
                </button>
            </header>
            <QueryStatus pending={query.pending()} error={query.error()} />
            <Show when={query.data()}>
                {(courses) => (
                    <>
                        <p>{courses().length}件の講義</p>
                        <ul class="app-list">
                            <For each={courses()} fallback={<li class="app-row">講義がありません。</li>}>
                                {(course) => (
                                    <li class="app-row">
                                        <Show when={course.archived}>
                                            <small class="app-meta">保存済み講義</small>
                                        </Show>
                                        {course.availability === "available"
                                            ? (
                                                <a href={paths.courses(course.lmsCourseId)}>
                                                    {course.name}
                                                </a>
                                            )
                                            : (
                                                <>
                                                    <span>{course.name}</span>
                                                    <small class="app-meta">利用不可</small>
                                                </>
                                            )}
                                    </li>
                                )}
                            </For>
                        </ul>
                    </>
                )}
            </Show>
        </>
    );
}
