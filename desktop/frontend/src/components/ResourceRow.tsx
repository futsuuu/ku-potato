import { Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { API, Schema } from "../api";
import { createOperation } from "../operation";
import { openExternal } from "../native";
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
  async function download(openAfter = true) {
    const { api, materialId, resource, reload } = untrack(() => ({
      api: props.api,
      materialId: props.materialId,
      resource: props.resource,
      reload: props.reload,
    }));
    await operation.run(async (observe) => {
      const result = await api.download(materialId, resource.lmsResourceId, observe);
      if (result.type === "external") {
        if (openAfter) openExternal(result.url);
        return;
      }
      if (openAfter) await api.openResource(materialId, resource.lmsResourceId);
    });
    reload();
  }
  async function open() {
    const { api, materialId, resource } = untrack(() => ({
      api: props.api,
      materialId: props.materialId,
      resource: props.resource,
    }));
    const saved = resource.savedFile;
    if (saved) {
      await operation.run(async () => api.openResource(materialId, resource.lmsResourceId));
    } else if (resource.availability === "archived" || resource.type === "unknown") {
      await operation.run(async () => openExternal(resource.url!));
    } else {
      await download();
    }
  }
  return (
    <li class="relative flex flex-col gap-md border-b-thin border-line border-solid px-section py-section [&:has(.resource-main:hover)]:bg-surface [&_.resource-main:focus-visible]:text-accent [&:has(.resource-main:hover)_.resource-main]:text-accent [&:has(.resource-main:focus-visible)]:outline-focus [&:has(.resource-main:focus-visible)]:outline-accent [&:has(.resource-main:focus-visible)]:outline-offset-focus [&:has(.resource-main:focus-visible)]:outline-solid">
      <div class="flex items-center justify-between gap-md">
        <button
          class="resource-main text-left after:absolute after:inset-none after:content-empty [&_span]:underlined-link"
          disabled={
            operation.pending() ||
            (!props.resource.savedFile &&
              (props.resource.availability === "archived" || props.resource.type === "unknown") &&
              !props.resource.url)
          }
          onClick={() => void open()}
        >
          <BudouxText text={props.resource.name} />
        </button>
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
        <Show when={props.resource.type === "external" && props.resource.url}>
          <ResourceActionButton
            disabled={operation.pending()}
            onClick={() => {
              const url = props.resource.url!;
              void operation.run(async () => openExternal(url));
            }}
          >
            <span class="i-lucide-external-link" aria-hidden="true" />
            リンクを開く
          </ResourceActionButton>
        </Show>
        <Show when={props.resource.type === "external" && props.resource.savedFile}>
          <ResourceActionButton
            disabled={operation.pending() || props.resource.availability === "archived"}
            onClick={() => void download(false)}
          >
            <span class="i-lucide-download" aria-hidden="true" />
            再ダウンロード
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
