import { createEffect, createSignal, For, Show, onCleanup, untrack } from "solid-js";
import { createAPI, type API, type Result, type Schema, type Sync } from "./api";
import { createOperation } from "./operation";
import { formatDate, materialTypes, upcoming } from "./format";
import { openExternal, saveFile, serverURL } from "./native";
import Progress from "./Progress";
import "virtual:uno.css";

function MaterialInfo(props: { material: Schema["Material"] }) {
  return (
    <small class="meta">
      {materialTypes[props.material.type]} · {formatDate(props.material.publicationDeadline)}
      {props.material.resourceAvailability === "unavailable" ? " · 現在は非公開" : ""}
      {props.material.archived ? " · 過去の取得データ" : ""}
      {props.material.archived && props.material.fetchedAt
        ? ` · ${formatDate(props.material.fetchedAt)}取得`
        : ""}
    </small>
  );
}

function ResourceRow(props: {
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
    <li class="row">
      <div class="row-main">
        <strong>{props.resource.name}</strong>
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
            props.resource.type === "unsupported" ||
            props.resource.availability === "archived"
          }
          onClick={() => void download()}
        >
          取得
        </button>
        <Show when={props.resource.savedFile}>
          <button
            class="app-button"
            disabled={operation.pending()}
            onClick={() => void saveExisting()}
          >
            保存済みファイルを取り出す
          </button>
        </Show>
        <Show when={props.resource.url}>
          <button class="app-button" onClick={() => openExternal(props.resource.url!)}>
            外部資料を開く
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

function Workspace(props: { api: API }) {
  const api = () => untrack(() => props.api);
  const [page, setPage] = createSignal<"courses" | "assignments" | "materials" | "detail">(
    "courses",
  );
  const [course, setCourse] = createSignal<Schema["Course"] | undefined>(undefined);
  const [material, setMaterial] = createSignal<Schema["Material"] | undefined>(undefined);
  const [auth, setAuth] = createSignal<Schema["AuthState"]>({ status: "unknown" });
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(timer));
  const courses = createOperation<Result<"listCourses">>();
  const assignments = createOperation<Result<"listAssignments">>();
  const materials = createOperation<Result<"listMaterials">>();
  const detail = createOperation<Result<"getMaterial">>();
  const authentication = createOperation<Schema["AuthState"]>();
  const loadCourses = (sync: Sync) => courses.run((observe) => api().courses(sync, observe));
  const loadAssignments = (sync: Sync) =>
    assignments.run((observe) => api().assignments(sync, observe));
  const loadMaterials = (id: string, sync: Sync) =>
    materials.run((observe) => api().materials(id, sync, observe));
  const loadDetail = (id: string, sync: Sync) =>
    detail.run((observe) => api().detail(id, sync, observe));
  function selectCourse(value: Schema["Course"]) {
    if (!value.lmsCourseId) return;
    materials.clear();
    setCourse(value);
    setPage("materials");
    void loadMaterials(value.lmsCourseId, "auto");
  }
  function selectMaterial(value: Schema["Material"]) {
    detail.clear();
    setMaterial(value);
    setPage("detail");
    void loadDetail(value.lmsMaterialId, "auto");
  }
  async function authenticate(kind: "login" | "check" | "logout" | "register") {
    const state = await authentication.run(async (observe) => {
      if (kind === "register") {
        await api().register(observe);
        return api().auth();
      }
      return api()[kind](observe);
    });
    if (state) {
      setAuth(state);
      if (kind === "login") void loadCourses("true");
    }
  }
  const courseName = (id: string) =>
    courses.data()?.find((value) => value.lmsCourseId === id)?.name ?? id;
  createEffect(
    () => props.api,
    (api) => {
      void api
        .auth()
        .then(setAuth)
        .catch(() => {});
      void loadCourses("auto");
    },
  );

  return (
    <div class="app">
      <aside class="sidebar">
        <strong>KU-POTATO</strong>
        <nav aria-label="ナビゲーション">
          <button
            class="app-button text-left"
            aria-current={page() !== "assignments" ? "page" : undefined}
            onClick={() => setPage("courses")}
          >
            講義・教材
          </button>
          <button
            class="app-button text-left"
            aria-current={page() === "assignments" ? "page" : undefined}
            onClick={() => {
              setPage("assignments");
              void loadAssignments("auto");
            }}
          >
            期限前の課題
          </button>
        </nav>
        <section class="auth" aria-label="認証">
          <strong>
            {auth().status === "authenticated"
              ? "ログイン済み"
              : auth().status === "unauthenticated"
                ? "未ログイン"
                : "認証未確認"}
          </strong>
          <button
            class="app-button"
            disabled={authentication.pending()}
            onClick={() => void authenticate("login")}
          >
            ブラウザでログイン
          </button>
          <button
            class="app-button"
            disabled={authentication.pending()}
            onClick={() => void authenticate("check")}
          >
            認証状態を確認
          </button>
          <details>
            <summary>認証の設定</summary>
            <button
              class="app-button"
              disabled={authentication.pending()}
              onClick={() => void authenticate("register")}
            >
              認証デバイスを登録
            </button>
            <button
              class="app-button"
              disabled={authentication.pending()}
              onClick={() => {
                if (window.confirm("保存済みのログイン情報と認証デバイスの鍵を削除しますか？"))
                  void authenticate("logout");
              }}
            >
              ログアウト
            </button>
          </details>
          <Progress
            pending={authentication.pending()}
            error={authentication.error()}
            status={authentication.status()}
          />
        </section>
      </aside>
      <main>
        <Show when={page() === "courses"}>
          <header>
            <div>
              <h1>講義一覧</h1>
            </div>
            <button
              class="app-button"
              disabled={courses.pending()}
              onClick={() => void loadCourses("true")}
            >
              講義を同期
            </button>
          </header>
          <Progress pending={courses.pending()} error={courses.error()} status={courses.status()} />
          <p class="meta">{courses.data()?.length ?? 0}件の講義</p>
          <ul class="list">
            <For each={courses.data() ?? []} fallback={<li class="empty">講義がありません。</li>}>
              {(value) => (
                <li>
                  <button
                    class="course-card"
                    disabled={!value.lmsCourseId}
                    onClick={() => selectCourse(value)}
                  >
                    <span>
                      <strong>{value.name}</strong>
                      <small>
                        {value.archived
                          ? "保存済み講義"
                          : value.availability === "unavailable"
                            ? "利用不可"
                            : ""}
                      </small>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={page() === "assignments"}>
          <header>
            <div>
              <h1>期限前の課題</h1>
            </div>
            <button
              class="app-button"
              disabled={assignments.pending()}
              onClick={() => void loadAssignments("true")}
            >
              課題を同期
            </button>
          </header>
          <Progress
            pending={assignments.pending()}
            error={assignments.error()}
            status={assignments.status()}
          />
          <For each={assignments.data()?.failures ?? []}>
            {(failure) => (
              <p class="error" role="alert">
                {courseName(failure.lmsCourseId)}: {failure.error.message}
              </p>
            )}
          </For>
          <ul class="list">
            <For
              each={upcoming(assignments.data()?.assignments ?? [], now())}
              fallback={<li class="empty">期限前の課題はありません。</li>}
            >
              {(value) => (
                <li class="row">
                  <strong>{value.material.name}</strong>
                  <MaterialInfo material={value.material} />
                  <button
                    class="app-link"
                    onClick={() =>
                      selectCourse(
                        courses.data()?.find((item) => item.lmsCourseId === value.lmsCourseId) ?? {
                          name: courseName(value.lmsCourseId),
                          lmsCourseId: value.lmsCourseId,
                          availability: "available",
                        },
                      )
                    }
                  >
                    {courseName(value.lmsCourseId)} · {value.folderName}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={page() === "materials"}>
          <button class="app-link" onClick={() => setPage("courses")}>
            ← 講義一覧
          </button>
          <header>
            <div>
              <h1>{course()?.name}</h1>
            </div>
            <button
              class="app-button"
              disabled={materials.pending()}
              onClick={() => void loadMaterials(course()!.lmsCourseId!, "true")}
            >
              教材を同期
            </button>
          </header>
          <Progress
            pending={materials.pending()}
            error={materials.error()}
            status={materials.status()}
          />
          <For
            each={materials.data()?.folders ?? []}
            fallback={<p class="empty">教材がありません。</p>}
          >
            {(folder) => (
              <section>
                <h2>{folder.name}</h2>
                <Show when={folder.classDate}>
                  <small class="meta">授業日: {formatDate(folder.classDate!)}</small>
                </Show>
                <ul class="list">
                  <For each={folder.materials ?? []}>
                    {(value) => (
                      <li class="row">
                        <button
                          class="app-link material-name"
                          disabled={value.type !== "material"}
                          onClick={() => selectMaterial(value)}
                        >
                          {value.name}
                        </button>
                        <MaterialInfo material={value} />
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
        </Show>
        <Show when={page() === "detail"}>
          <button class="app-link" onClick={() => setPage("materials")}>
            ← {course()?.name}の教材
          </button>
          <header>
            <div>
              <h1>{detail.data()?.material.name ?? material()?.name}</h1>
              <Show when={detail.data()?.material ?? material()}>
                {(value) => <MaterialInfo material={value()} />}
              </Show>
            </div>
            <button
              class="app-button"
              disabled={detail.pending()}
              onClick={() => void loadDetail(material()!.lmsMaterialId, "true")}
            >
              資料を同期
            </button>
          </header>
          <Progress pending={detail.pending()} error={detail.error()} status={detail.status()} />
          <ul class="list">
            <For
              each={detail.data()?.resources ?? []}
              fallback={
                <li class="empty">
                  {detail.data()?.material.archived
                    ? "過去に取得した資料データがありません。"
                    : "資料がありません。"}
                </li>
              }
            >
              {(value) => (
                <ResourceRow
                  api={props.api}
                  materialId={material()!.lmsMaterialId}
                  resource={value}
                  reload={() => void loadDetail(material()!.lmsMaterialId, "false")}
                />
              )}
            </For>
          </ul>
        </Show>
      </main>
    </div>
  );
}

export default function App() {
  const connection = createOperation<API>();
  createEffect(
    () => true,
    () => {
      void connection.run(async () => createAPI(await serverURL()));
    },
  );
  return (
    <Show
      when={connection.data()}
      fallback={
        <div class="p-lg">
          <Progress pending={connection.pending()} error={connection.error()} />
          <Show when={connection.error()}>
            <button class="app-button" onClick={() => window.location.reload()}>
              再読み込み
            </button>
          </Show>
        </div>
      }
    >
      {(api) => <Workspace api={api()} />}
    </Show>
  );
}
