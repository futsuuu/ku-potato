import { Title } from "@solidjs/meta";
import { For, Show } from "solid-js";
import QueryStatus from "../components/QueryStatus.tsx";
import { createDesktopQuery } from "../query.ts";
import { paths } from "../router.ts";

export default function Courses() {
    const query = createDesktopQuery(() => "courses", (_, sync) => bindings.listCourses(sync));
    return (
        <>
            <Title>講義一覧 | KU-POTATO</Title>
            <header>
                <h1>講義一覧</h1>
                <button type="button" disabled={query.pending()} onClick={query.refresh}>再取得</button>
            </header>
            <QueryStatus pending={query.pending()} error={query.error()} />
            <Show when={query.data()}>
                {(courses) => (
                    <>
                        <p>{courses().length}件の講義</p>
                        <ul>
                            <For each={courses()} fallback={<li>講義がありません。</li>}>
                                {(course) => (
                                    <li>
                                        {course.availability === "available"
                                            ? (
                                                <a href={paths.courses(course.lmsCourseId)}>
                                                    {course.name}
                                                </a>
                                            )
                                            : (
                                                <>
                                                    <span>{course.name}</span>
                                                    <small>利用不可</small>
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
