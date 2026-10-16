import { createEffect, createSignal, For, onCleanup } from "solid-js";
import type { Result, Sync } from "../api";
import { upcoming } from "../format";
import { createOperation } from "../operation";
import { coursePath, materialPath, useWorkspace } from "../workspace";
import MaterialSummary from "../components/MaterialSummary";
import PageHeader from "../components/PageHeader";
import Progress from "../components/Progress";
import RefreshButton from "../components/RefreshButton";

export default function Assignments() {
  const workspace = useWorkspace();
  const assignments = createOperation<Result<"listAssignments">>();
  const load = (sync: Sync) =>
    assignments.run((observe) => workspace.api.assignments(sync, observe));
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(timer));
  createEffect(
    () => true,
    () => {
      void load("auto");
    },
  );
  return (
    <>
      <PageHeader title="期限前の課題">
        <RefreshButton
          label="課題を同期"
          disabled={assignments.pending()}
          onClick={() => void load("true")}
        />
      </PageHeader>
      <div class="page-content">
        <div class="section-intro">
          <h2>提出予定</h2>
          <span class="muted-note">締切が近い順</span>
        </div>
        <Progress
          pending={assignments.pending()}
          error={assignments.error()}
          status={assignments.status()}
        />
        <For each={assignments.data()?.failures ?? []}>
          {(failure) => (
            <p class="error-message" role="alert">
              {workspace.courseName(failure.lmsCourseId)}: {failure.error.message}
            </p>
          )}
        </For>
        <ul class="item-list">
          <For
            each={upcoming(assignments.data()?.assignments ?? [], now())}
            fallback={
              <li class="no-content">
                {assignments.pending() ? "課題を読み込んでいます。" : "期限前の課題はありません。"}
              </li>
            }
          >
            {(assignment) => (
              <li>
                <a
                  class="item-link linked-item"
                  href={
                    assignment.material.type === "report"
                      ? materialPath(assignment.lmsCourseId, assignment.material.lmsMaterialId)
                      : coursePath(assignment.lmsCourseId)
                  }
                >
                  <MaterialSummary material={assignment.material}>
                    <span class="muted-note">
                      {workspace.courseName(assignment.lmsCourseId)} · {assignment.folderName}
                    </span>
                  </MaterialSummary>
                </a>
              </li>
            )}
          </For>
        </ul>
      </div>
    </>
  );
}
