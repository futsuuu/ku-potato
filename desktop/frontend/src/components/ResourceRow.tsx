import { Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { API, Schema } from "../api";
import { createOperation } from "../operation";
import { openExternal, saveFile } from "../native";
import Progress from "./Progress";
import BudouxText from "./BudouxText";

function ResourceActionButton(props: {
  disabled: boolean;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      class="relative z-action app-button"
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}

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
    <li class="relative flex flex-col gap-md border-b-thin border-line border-solid px-section py-section [&:has(a:hover)]:bg-surface [&_a:focus-visible]:text-accent [&:has(a:hover)_a]:text-accent [&:has(a:focus-visible)]:outline-focus [&:has(a:focus-visible)]:outline-accent [&:has(a:focus-visible)]:outline-offset-focus [&:has(a:focus-visible)]:outline-solid">
      <div class="flex items-center justify-between gap-md">
        <Show
          when={props.resource.url}
          fallback={
            <span>
              <BudouxText text={props.resource.name} />
            </span>
          }
        >
          {(url) => (
            <a
              class="inline after:absolute after:inset-none after:content-empty [&_.link-label]:underlined-link"
              href={url()}
              aria-label={`${props.resource.name}（外部ブラウザで開く）`}
              onClick={(event) => {
                event.preventDefault();
                openExternal(url());
              }}
            >
              <span class="link-label">
                <BudouxText text={props.resource.name} />
              </span>
              <span class="i-lucide-external-link ml-xs align-middle" aria-hidden="true" />
            </a>
          )}
        </Show>
        <span class="text-small text-muted">
          {props.resource.type === "file"
            ? "ファイル"
            : props.resource.type === "external"
              ? "外部リンク"
              : "未対応"}
        </span>
      </div>
      <Show when={props.resource.availability === "archived"}>
        <small class="muted-note">過去の取得データ（現在は公開されていません）</small>
      </Show>
      <div class="flex flex-wrap gap-sm">
        <ResourceActionButton
          disabled={
            operation.pending() ||
            props.resource.type === "unknown" ||
            props.resource.availability === "archived"
          }
          onClick={() => void download()}
        >
          <span class="i-lucide-download" aria-hidden="true" />
          取得
        </ResourceActionButton>
        <Show when={props.resource.savedFile}>
          <ResourceActionButton disabled={operation.pending()} onClick={() => void saveExisting()}>
            <span class="i-lucide-save" aria-hidden="true" />
            保存済みファイルを取り出す
          </ResourceActionButton>
        </Show>
      </div>
      <Show when={props.resource.acquisition?.lastAttempt.error}>
        <p class="error-message">{props.resource.acquisition?.lastAttempt.error}</p>
      </Show>
      <Progress
        pending={operation.pending()}
        error={operation.error()}
        status={operation.status()}
      />
    </li>
  );
}
