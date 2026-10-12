import { createEffect, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import type { Result, Sync } from "../../../../api";
import { createOperation } from "../../../../operation";
import { coursePath, decodeRouteParam, useWorkspace } from "../../../../workspace";
import MaterialInfo from "../../../../MaterialInfo";
import MaterialIcon from "../../../../MaterialIcon";
import ResourceRow from "../../../../ResourceRow";
import PageHeader from "../../../../PageHeader";
import ParentLink from "../../../../ParentLink";
import Progress from "../../../../Progress";
import ReportContent from "../../../../ReportContent";

export default function MaterialDetail() {
  const workspace = useWorkspace();
  const params = useParams<{ courseId: string; materialId: string }>();
  const courseId = () => decodeRouteParam(params.courseId);
  const materialId = () => decodeRouteParam(params.materialId);
  const detail = createOperation<Result<"getMaterial">>();
  const load = (id: string, sync: Sync) =>
    detail.run((observe) => workspace.api.detail(id, sync, observe));
  createEffect(materialId, (id) => {
    detail.clear();
    void load(id, "auto");
  });
  return (
    <>
      <PageHeader
        title={detail.data()?.material.name ?? "教材の詳細"}
        icon={
          <Show when={detail.data()?.material}>
            {(material) => <MaterialIcon type={material().type} />}
          </Show>
        }
      >
        <button
          class="app-button"
          disabled={detail.pending()}
          onClick={() => void load(materialId(), "true")}
        >
          <span class="i-lucide-refresh-cw" aria-hidden="true" />
          {detail.data()?.material.type === "report" ? "レポートを同期" : "資料を同期"}
        </button>
      </PageHeader>
      <div class="page-content">
        <ParentLink href={coursePath(courseId())} label={workspace.courseName(courseId())} />
        <Show when={detail.data()?.material}>
          {(material) => <MaterialInfo material={material()} />}
        </Show>
        <Progress pending={detail.pending()} error={detail.error()} status={detail.status()} />
        <Show
          when={detail.data()?.material.type === "report"}
          fallback={
            <>
              <div class="section-intro">
                <h2>資料</h2>
                <span class="meta tnum">{detail.data()?.resources?.length ?? 0}件</span>
              </div>
              <ul class="list">
                <For
                  each={detail.data()?.resources ?? []}
                  fallback={
                    <li class="empty">
                      {detail.pending()
                        ? "資料を読み込んでいます。"
                        : detail.data()?.material.archived
                          ? "過去に取得した資料データがありません。"
                          : "資料がありません。"}
                    </li>
                  }
                >
                  {(resource) => (
                    <ResourceRow
                      api={workspace.api}
                      materialId={materialId()}
                      resource={resource}
                      reload={() => void load(materialId(), "false")}
                    />
                  )}
                </For>
              </ul>
            </>
          }
        >
          <Show
            when={detail.data()?.report}
            fallback={
              <p class="empty">
                {detail.pending()
                  ? "レポートを読み込んでいます。"
                  : detail.data()?.material.archived
                    ? "過去に取得したレポートの内容はありません。"
                    : "レポートの内容が取得されていません。"}
              </p>
            }
          >
            {(report) => (
              <ReportContent report={report()} archived={!!detail.data()?.material.archived} />
            )}
          </Show>
        </Show>
      </div>
    </>
  );
}
