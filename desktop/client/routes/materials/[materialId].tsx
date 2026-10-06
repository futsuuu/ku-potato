import { Title } from "@solidjs/meta";
import { useParams } from "@solidjs/router";
import { For, Show } from "solid-js";
import MaterialInfo from "../../components/MaterialInfo.tsx";
import QueryStatus from "../../components/QueryStatus.tsx";
import { createDesktopQuery } from "../../query.ts";
import { paths } from "../../router.ts";

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
                                {(resource) => <li class="app-row">{resource.name}</li>}
                            </For>
                        </ul>
                    </>
                )}
            </Show>
        </>
    );
}
