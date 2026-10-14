import { For, Show } from "solid-js";
import PageHeader from "../PageHeader";
import Progress from "../Progress";
import { groupCourses } from "../course-groups";
import { coursePath, useWorkspace } from "../workspace";
import type { Schema } from "../api";

function CourseInfo(props: { course: Schema["Course"] }) {
  return (
    <div class="item-content">
      <span class="link-label">{props.course.name}</span>
      <Show
        when={
          props.course.period ||
          props.course.archived ||
          props.course.availability === "unavailable"
        }
      >
        <small class="meta tnum">
          {[
            props.course.period ? `${props.course.period}限` : "",
            props.course.archived ? "保存済み講義" : "",
            props.course.availability === "unavailable" ? "利用不可" : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </Show>
    </div>
  );
}

export default function Courses() {
  const workspace = useWorkspace();
  const groups = () => groupCourses(workspace.courses.data() ?? []);
  return (
    <>
      <PageHeader title="講義一覧">
        <button
          class="icon-button"
          aria-label="講義を同期"
          title="講義を同期"
          disabled={workspace.courses.pending()}
          onClick={() => void workspace.loadCourses("true")}
        >
          <span class="i-lucide-refresh-cw" aria-hidden="true" />
        </button>
      </PageHeader>
      <div class="page-content">
        <p class="course-count meta tnum">{workspace.courses.data()?.length ?? 0}件の講義</p>
        <Progress
          pending={workspace.courses.pending()}
          error={workspace.courses.error()}
          status={workspace.courses.status()}
        />
        <For
          each={groups()}
          fallback={
            <p class="empty">
              {workspace.courses.pending() ? "講義を読み込んでいます。" : "講義がありません。"}
            </p>
          }
        >
          {(group) => (
            <section class="course-section">
              <h2>{group.label}</h2>
              <ul class="list">
                <For each={group.courses}>
                  {(course) => (
                    <li>
                      <Show
                        when={course.lmsCourseId}
                        fallback={
                          <div class="course-link">
                            <CourseInfo course={course} />
                            <Show when={course.availability !== "unavailable"}>
                              <span class="meta">利用不可</span>
                            </Show>
                          </div>
                        }
                      >
                        {(id) => (
                          <a class="course-link" href={coursePath(id())}>
                            <CourseInfo course={course} />
                          </a>
                        )}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          )}
        </For>
      </div>
    </>
  );
}
