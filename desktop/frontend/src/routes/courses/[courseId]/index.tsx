/* oxlint-disable solid/no-innerhtml -- Render only the allowlisted HTML sanitized by DOMPurify below. */
import { createEffect, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import type { Result, Sync } from "../../../api";
import { formatDate } from "../../../format";
import { createOperation } from "../../../operation";
import { decodeRouteParam, materialPath, useWorkspace } from "../../../workspace";
import MaterialInfo from "../../../components/MaterialInfo";
import MaterialName from "../../../components/MaterialName";
import PageHeader from "../../../components/PageHeader";
import Progress from "../../../components/Progress";
import { compactFolderDescriptionHtml, openLmsHtmlLink } from "../../../lms-html";

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
        <button
          class="icon-button"
          aria-label="教材を同期"
          title="教材を同期"
          disabled={materials.pending()}
          onClick={() => void load(courseId(), "true")}
        >
          <span class="i-lucide-refresh-cw" aria-hidden="true" />
        </button>
      </PageHeader>
      <div class="page-content">
        <div class="section-intro">
          <h2>教材一覧</h2>
          <span class="meta tnum">{materials.data()?.folders?.length ?? 0}件のフォルダ</span>
        </div>
        <Progress
          pending={materials.pending()}
          error={materials.error()}
          status={materials.status()}
        />
        <For
          each={materials.data()?.folders ?? []}
          fallback={
            <p class="empty">
              {materials.pending() ? "教材を読み込んでいます。" : "教材がありません。"}
            </p>
          }
        >
          {(folder) => (
            <section class="folder-section">
              <div class="folder-heading">
                <h3>{folder.name}</h3>
                <Show when={folder.classDate}>
                  <small class="meta tnum">授業日: {formatDate(folder.classDate!)}</small>
                </Show>
                <Show when={folder.descriptionHtml?.trim()}>
                  <div
                    class="folder-description report-links:i-lucide-external-link"
                    innerHTML={compactFolderDescriptionHtml(folder.descriptionHtml!)}
                    onClick={openLmsHtmlLink}
                  />
                </Show>
              </div>
              <ul class="list">
                <For
                  each={folder.materials ?? []}
                  fallback={<li class="empty">このフォルダに教材はありません。</li>}
                >
                  {(material) => (
                    <li>
                      <Show
                        when={material.type === "material" || material.type === "report"}
                        fallback={
                          <div class="item-link">
                            <div class="item-content">
                              <MaterialName material={material} />
                              <MaterialInfo material={material} />
                            </div>
                          </div>
                        }
                      >
                        <a
                          class="item-link"
                          href={materialPath(courseId(), material.lmsMaterialId)}
                        >
                          <div class="item-content">
                            <MaterialName material={material} />
                            <MaterialInfo material={material} />
                          </div>
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
