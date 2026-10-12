import { Show, untrack } from "solid-js";
import type { API, Schema } from "./api";
import { createOperation } from "./operation";
import { openExternal, saveFile } from "./native";
import Progress from "./Progress";

export default function ResourceRow(props: {
  api: API;
  materialId: string;
  resource: Schema["Resource"];
  reload: () => void;
}) {
  const operation = createOperation<void>();
  async function download() {
    const { api, materialId, resource, reload } = untrack(() => ({
      api: props.api,
      materialId: props.materialId,
      resource: props.resource,
      reload: props.reload,
    }));
    await operation.run(async (observe) => {
      const result = await api.download(materialId, resource.lmsResourceId, observe);
      if (result.type === "external") {
        openExternal(result.url);
        return;
      }
      const blob = await api.file(materialId, resource.lmsResourceId);
      await saveFile(result.file.originalFilename, blob);
    });
    reload();
  }
  async function saveExisting() {
    const { api, materialId, resource } = untrack(() => ({
      api: props.api,
      materialId: props.materialId,
      resource: props.resource,
    }));
    await operation.run(async () => {
      const blob = await api.file(materialId, resource.lmsResourceId);
      await saveFile(resource.savedFile?.originalFilename ?? resource.name, blob);
    });
  }
  return (
    <li class="resource-row row">
      <div class="row-main">
        <Show when={props.resource.url} fallback={<span>{props.resource.name}</span>}>
          {(url) => (
            <a
              class="resource-link"
              href={url()}
              aria-label={`${props.resource.name}（外部ブラウザで開く）`}
              onClick={(event) => {
                event.preventDefault();
                openExternal(url());
              }}
            >
              <span class="link-label">{props.resource.name}</span>
              <span class="external-link-icon i-lucide-external-link" aria-hidden="true" />
            </a>
          )}
        </Show>
        <span class="tag">
          {props.resource.type === "file"
            ? "ファイル"
            : props.resource.type === "external"
              ? "外部リンク"
              : "未対応"}
        </span>
      </div>
      <Show when={props.resource.availability === "archived"}>
        <small class="meta">過去の取得データ（現在は公開されていません）</small>
      </Show>
      <div class="actions">
        <button
          class="app-button"
          disabled={
            operation.pending() ||
            props.resource.type === "unknown" ||
            props.resource.availability === "archived"
          }
          onClick={() => void download()}
        >
          <span class="i-lucide-download" aria-hidden="true" />
          取得
        </button>
        <Show when={props.resource.savedFile}>
          <button
            class="app-button"
            disabled={operation.pending()}
            onClick={() => void saveExisting()}
          >
            <span class="i-lucide-save" aria-hidden="true" />
            保存済みファイルを取り出す
          </button>
        </Show>
      </div>
      <Show when={props.resource.acquisition?.lastAttempt.error}>
        <p class="error">{props.resource.acquisition?.lastAttempt.error}</p>
      </Show>
      <Progress
        pending={operation.pending()}
        error={operation.error()}
        status={operation.status()}
      />
    </li>
  );
}
