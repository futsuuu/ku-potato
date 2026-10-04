import { Title } from "@solidjs/meta";
import { useParams } from "@solidjs/router";
import { For, Show } from "solid-js";
import MaterialInfo, { formatDate } from "../../components/MaterialInfo.tsx";
import QueryStatus from "../../components/QueryStatus.tsx";
import { createDesktopQuery } from "../../query.ts";
import { paths } from "../../router.ts";

export default function Materials() {
    const params = useParams(paths.courses);
    const query = createDesktopQuery(() => params.courseId, (id, sync) => bindings.listMaterials(id, sync));
    return (
        <>
            <Title>{query.data()?.courseName ?? "教材一覧"} | KU-POTATO</Title>
            <header>
                <h1>{query.data()?.courseName ?? "講義"}</h1>
                <button type="button" disabled={query.pending()} onClick={query.refresh}>再取得</button>
            </header>
            <QueryStatus pending={query.pending()} error={query.error()} />
            <Show when={query.data()}>
                {(course) => (
                    <Show
                        when={course().folders.some((folder) => folder.materials.length > 0)}
                        fallback={<p>教材がありません。</p>}
                    >
                        <For each={course().folders}>
                            {(folder) => (
                                <section>
                                    <h2>{folder.name}</h2>
                                    <Show when={folder.classDate}>
                                        {(date) => <p>授業日: {formatDate(date())}</p>}
                                    </Show>
                                    <ul>
                                        <For
                                            each={folder.materials}
                                            fallback={<li>このフォルダに教材はありません。</li>}
                                        >
                                            {(material) => (
                                                <li>
                                                    {material.type === "material" &&
                                                            material.resourceAvailability === "available"
                                                        ? (
                                                            <a href={paths.materials(material.lmsMaterialId)}>
                                                                {material.name}
                                                            </a>
                                                        )
                                                        : <span>{material.name}</span>}
                                                    <MaterialInfo material={material} />
                                                    <Show
                                                        when={material.type === "material" &&
                                                            material.resourceAvailability === "unavailable"}
                                                    >
                                                        <small>資料未公開</small>
                                                    </Show>
                                                </li>
                                            )}
                                        </For>
                                    </ul>
                                </section>
                            )}
                        </For>
                    </Show>
                )}
            </Show>
        </>
    );
}
