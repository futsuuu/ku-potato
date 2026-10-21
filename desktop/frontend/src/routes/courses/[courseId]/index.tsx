import { createEffect, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import type { Result, Sync } from "../../../api";
import { formatDate } from "../../../format";
import { createOperation } from "../../../operation";
import { decodeRouteParam, materialPath, useWorkspace } from "../../../workspace";
import MaterialSummary from "../../../components/MaterialSummary";
import LmsHtmlContent from "../../../components/LmsHtmlContent";
import BudouxText from "../../../components/BudouxText";
import PageHeader from "../../../components/PageHeader";
import Progress from "../../../components/Progress";
import RefreshButton from "../../../components/RefreshButton";

export default function Materials() {
  const workspace = useWorkspace();
  const params = useParams<{ courseId: string }>();
  const courseId = () => decodeRouteParam(params.courseId);
  const materials = createOperation<Result<"listMaterials">>();
  const load = (id: string, sync: Sync) =>
    materials.run((observe) => workspace.api.materials(id, sync, observe));
  createEffect(courseId, (id) => {
    materials.clear();
    void load(id, "auto");
  });
  return (
    <>
      <PageHeader
        title={workspace.courseName(courseId())}
        ancestors={[{ label: "講義一覧", href: "/" }]}
      >
        <RefreshButton
          label="教材を同期"
          disabled={materials.pending()}
          onClick={() => void load(courseId(), "true")}
        />
      </PageHeader>
      <div class="page-content">
        <div class="section-intro">
          <h2>教材一覧</h2>
          <span class="muted-note tnum">{materials.data()?.folders?.length ?? 0}件のフォルダ</span>
        </div>
        <Progress
          pending={materials.pending()}
          error={materials.error()}
          status={materials.status()}
        />
        <For
          each={materials.data()?.folders ?? []}
          fallback={
            <p class="no-content">
              {materials.pending() ? "教材を読み込んでいます。" : "教材がありません。"}
            </p>
          }
        >
          {(folder) => (
            <section class="folder-section grid border-t-thin border-line border-solid grid-cols-asymmetric [&>ul]:flex [&>ul>li:last-child]:flex [&>ul>li:last-child]:flex-auto [&>ul>li:last-child>:first-child]:flex-auto [&>ul]:flex-col [&>ul>li:last-child]:flex-col [&>ul>li:last-child>:first-child]:items-start [&>ul]:border-t-none [&>ul>li>:first-child]:border-b-none lt-md:grid-cols-single">
              <div class="pb-section pl-none pr-lg pt-section lt-md:pb-md">
                <h3>
                  <BudouxText text={folder.name} />
                </h3>
                <Show when={folder.classDate}>
                  <small class="mt-sm muted-note tnum">
                    授業日: {formatDate(folder.classDate!)}
                  </small>
                </Show>
                <LmsHtmlContent html={folder.descriptionHtml ?? ""} kind="folder" />
              </div>
              <ul class="item-list">
                <For
                  each={folder.materials ?? []}
                  fallback={
                    <li class="p-section text-small text-muted">
                      このフォルダに教材はありません。
                    </li>
                  }
                >
                  {(material) => (
                    <li>
                      <Show
                        when={material.type === "material" || material.type === "report"}
                        fallback={
                          <div class="item-link">
                            <MaterialSummary material={material} />
                          </div>
                        }
                      >
                        <a
                          class="item-link linked-item"
                          href={materialPath(courseId(), material.lmsMaterialId)}
                        >
                          <MaterialSummary material={material} />
                        </a>
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
