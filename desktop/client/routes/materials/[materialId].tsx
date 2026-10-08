import { Title } from "@solidjs/meta";
import { useParams } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import type { ResourceDownload } from "../../../../domain/mod.ts";
import MaterialInfo from "../../components/MaterialInfo.tsx";
import QueryStatus from "../../components/QueryStatus.tsx";
import { createDesktopQuery } from "../../query.ts";
import { paths } from "../../router.ts";

function ResourceRow(
    props: {
        materialId: string;
        position: number;
        resource: import("../../../bindings.ts").DesktopResource;
        onFinished: () => void;
    },
) {
    const [pending, setPending] = createSignal(false);
    const [error, setError] = createSignal("");
    const [result, setResult] = createSignal<ResourceDownload | undefined>(undefined);
    const download = () => {
        if (pending()) return;
        setPending(true);
        setError("");
        setResult(undefined);
        void Promise.resolve().then(() =>
            bindings.downloadResource(props.materialId, props.position, props.resource.lmsResourceId)
        ).then(
            (response) => {
                if (response.status === "success") setResult(response.data);
                else setError(response.error.message);
            },
            () => setError("取得に失敗しました。もう一度お試しください。"),
        ).finally(() => {
            setPending(false);
            props.onFinished();
        });
    };
    return (
        <li class="app-row">
            <span>{props.resource.name}</span>
            <Show when={props.resource.availability === "archived"}>
                <span>保存済み資料（現在の一覧にはありません）</span>
            </Show>
            <button
                class="app-button"
                type="button"
                disabled={pending()}
                onClick={download}
            >
                {pending() ? "取得中…" : "取得"}
            </button>
            <Show when={result()}>
                {(value) => {
                    const retrieved = value();
                    return retrieved.type === "file"
                        ? <p>保存先: {retrieved.path}</p>
                        : <a href={retrieved.url} target="_blank" rel="noopener noreferrer">外部資料を開く</a>;
                }}
            </Show>
            <Show when={props.resource.savedFile}>
                {(file) => <p>保存済み: {file().originalFilename} ({file().size} bytes)</p>}
            </Show>
            <Show when={props.resource.savedPath && result()?.type !== "file"}>
                <p>保存先: {props.resource.savedPath}</p>
            </Show>
            <Show when={props.resource.url && result()?.type !== "external"}>
                <a href={props.resource.url} target="_blank" rel="noopener noreferrer">外部資料を開く</a>
            </Show>
            <Show
                when={props.resource.savedFile?.sourceUrl && props.resource.savedFile.sourceUrl !== props.resource.url}
            >
                <p>保存時のURL: {props.resource.savedFile?.sourceUrl}（現在のURLとは異なります）</p>
            </Show>
            <Show when={props.resource.acquisition?.lastSucceededAt}>
                <p>最終成功: {props.resource.acquisition?.lastSucceededAt}</p>
            </Show>
            <Show when={props.resource.acquisition?.lastAttempt}>
                <p>
                    直近の取得: {props.resource.acquisition?.lastAttempt.at}{" "}
                    {props.resource.acquisition?.lastAttempt.status}
                </p>
                <Show when={props.resource.acquisition?.lastAttempt.error}>
                    <p role="alert">{props.resource.acquisition?.lastAttempt.error}</p>
                </Show>
            </Show>
            <Show when={error()}>
                <p role="alert">{error()}</p>
            </Show>
        </li>
    );
}

export default function Resources() {
    const params = useParams(paths.materials);
    const query = createDesktopQuery(() => params.materialId, (id, sync) => bindings.viewMaterial(id, sync));
    return (
        <>
            <Title>{query.data()?.material.name ?? "資料一覧"} | KU-POTATO</Title>
            <header class="app-header">
                <h1>{query.data()?.material.name ?? "教材"}</h1>
                <button class="app-button" type="button" disabled={query.pending()} onClick={query.refresh}>
                    再取得
                </button>
            </header>
            <QueryStatus pending={query.pending()} error={query.error()} />
            <Show when={query.data()}>
                {(detail) => (
                    <>
                        <p>
                            <a href={paths.courses(detail().course.lmsCourseId)}>
                                {detail().course.name}の教材一覧へ
                            </a>
                        </p>
                        <MaterialInfo material={detail().material} />
                        <p>{detail().resources.length}件の資料</p>
                        <ul class="app-list">
                            <For each={detail().resources} fallback={<li class="app-row">資料がありません。</li>}>
                                {(resource, position) => (
                                    <ResourceRow
                                        materialId={detail().material.lmsMaterialId}
                                        position={position()}
                                        resource={resource}
                                        onFinished={query.reloadArchive}
                                    />
                                )}
                            </For>
                        </ul>
                    </>
                )}
            </Show>
        </>
    );
}
