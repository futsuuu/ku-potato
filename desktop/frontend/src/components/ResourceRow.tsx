import { Show, untrack } from "solid-js";
import Download from "@lucide/solid/icons/download";
import ExternalLink from "@lucide/solid/icons/external-link";
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
      class="resource-action app-button"
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
        if (openAfter) await openExternal(result.url);
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
    } else if (resource.archived || resource.type === "unknown") {
      await operation.run(async () => openExternal(resource.url!));
    } else {
      await download();
    }
  }
  return (
    <li class="resource-row">
      <div class="resource-heading">
        <button
          class="resource-main"
          disabled={
            operation.pending() ||
            (!props.resource.savedFile &&
              (props.resource.archived || props.resource.type === "unknown") &&
              !props.resource.url)
          }
          onClick={() => void open()}
        >
          <BudouxText text={props.resource.name} />
        </button>
        <span class="resource-type">
          {props.resource.type === "file"
            ? "ファイル"
            : props.resource.type === "external"
              ? "外部リンク"
              : "未対応"}
        </span>
      </div>
      <Show when={props.resource.archived}>
        <small class="muted-note">過去の取得データ（現在は公開されていません）</small>
      </Show>
      <div class="resource-actions">
        <Show when={props.resource.type === "external" && props.resource.url}>
          <ResourceActionButton
            disabled={operation.pending()}
            onClick={() => {
              const url = props.resource.url!;
              void operation.run(async () => openExternal(url));
            }}
          >
            <ExternalLink class="icon" aria-hidden="true" />
            リンクを開く
          </ResourceActionButton>
        </Show>
        <Show when={props.resource.type === "external" && props.resource.savedFile}>
          <ResourceActionButton
            disabled={operation.pending() || !!props.resource.archived}
            onClick={() => void download(false)}
          >
            <Download class="icon" aria-hidden="true" />
            再ダウンロード
          </ResourceActionButton>
        </Show>
      </div>
      <Progress
        pending={operation.pending()}
        error={operation.error()}
        status={operation.status()}
      />
    </li>
  );
}
