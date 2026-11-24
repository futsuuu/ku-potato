import { For, Show } from "solid-js";
import BudouxText from "../../components/BudouxText";
import ItemContent from "../../components/ItemContent";
import PageHeader from "../../components/PageHeader";
import Progress from "../../components/Progress";
import RefreshButton from "../../components/RefreshButton";
import { groupCourses } from "./course-groups";
import { coursePath, useWorkspace } from "../../workspace";
import type { Schema } from "../../api";

function CourseInfo(props: { course: Schema["Course"] }) {
  return (
    <ItemContent>
      <span class="link-label">
        <BudouxText text={props.course.name} />
      </span>
      <Show
        when={
          props.course.type === "scheduled" ||
          props.course.archived ||
          props.course.availability === "unavailable"
        }
      >
        <small class="muted-note tnum">
          {[
            props.course.type === "scheduled" ? `${props.course.period}限` : "",
            props.course.archived ? "保存済み講義" : "",
            props.course.availability === "unavailable" ? "利用不可" : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </Show>
    </ItemContent>
  );
}

function CourseRow(props: { course: Schema["Course"] }) {
  return (
    <li>
      <Show
        when={props.course.availability === "available" && props.course.lmsCourseId}
        fallback={
          <div class="course-link">
            <CourseInfo course={props.course} />
            <Show when={props.course.availability !== "unavailable"}>
              <span class="muted-note">利用不可</span>
            </Show>
          </div>
        }
      >
        {(id) => (
          <a class="course-link linked-item" href={coursePath(id())}>
            <CourseInfo course={props.course} />
          </a>
        )}
      </Show>
    </li>
  );
}

export default function Courses() {
  const workspace = useWorkspace();
  const groups = () => groupCourses(workspace.courses.data() ?? []);
  return (
    <>
      <PageHeader title="講義一覧">
        <RefreshButton
          label="講義を同期"
          disabled={workspace.courses.pending()}
          onClick={() => void workspace.loadCourses("true")}
        />
      </PageHeader>
      <div class="page-content">
        <p class="course-count muted-note tnum">{workspace.courses.data()?.length ?? 0}件の講義</p>
        <Progress
          pending={workspace.courses.pending()}
          error={workspace.courses.error()}
          status={workspace.courses.status()}
        />
        <For
          each={groups()}
          fallback={
            <p class="no-content">
              {workspace.courses.pending() ? "講義を読み込んでいます。" : "講義がありません。"}
            </p>
          }
        >
          {(group) => (
            <section class="course-group">
              <h2 class="section-heading">{group.label}</h2>
              <ul class="item-list">
                <For each={group.courses}>{(course) => <CourseRow course={course} />}</For>
              </ul>
            </section>
          )}
        </For>
      </div>
    </>
  );
}
