import { createEffect, Loading, Show } from "solid-js";
import { useLocation } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import { useWorkspace } from "./workspace";
import Progress from "./Progress";
import PageHeader from "./PageHeader";

export default function Layout(props: { children: JSX.Element }) {
  const workspace = useWorkspace();
  const location = useLocation();
  createEffect(
    () => location.pathname,
    () => {
      const content = document.querySelector(".page-content");
      if (content) content.scrollTop = 0;
    },
  );
  return (
    <div class="app">
      <button class="skip-link" onClick={() => document.getElementById("main-content")?.focus()}>
        本文へ移動
      </button>
      <aside class="sidebar">
        <a class="brand" href="/" aria-label="KU-POTATO 講義一覧">
          KU-POTATO
        </a>
        <nav class="navigation" aria-label="ナビゲーション">
          <a
            class="nav-link"
            href="/"
            aria-current={
              location.pathname === "/" || location.pathname.startsWith("/courses/")
                ? "page"
                : undefined
            }
          >
            <span class="i-lucide-book-open" aria-hidden="true" />
            講義・教材
          </a>
          <a
            class="nav-link"
            href="/assignments"
            aria-current={location.pathname === "/assignments" ? "page" : undefined}
          >
            <span class="i-lucide-calendar-clock" aria-hidden="true" />
            期限前の課題
          </a>
        </nav>
        <section class="auth" aria-label="認証">
          <span>
            {workspace.auth().status === "authenticated"
              ? "ログイン済み"
              : workspace.auth().status === "unauthenticated"
                ? "未ログイン"
                : "認証未確認"}
          </span>
          <button
            class="app-button"
            disabled={workspace.authentication.pending()}
            onClick={() => void workspace.authenticate("login")}
          >
            <span class="i-lucide-log-in" aria-hidden="true" />
            ブラウザでログイン
          </button>
          <button
            class="quiet-button"
            disabled={workspace.authentication.pending()}
            onClick={() => void workspace.authenticate("check")}
          >
            認証状態を確認
          </button>
          <details>
            <summary>認証の設定</summary>
            <div class="auth-settings">
              <button
                class="quiet-button"
                disabled={workspace.authentication.pending()}
                onClick={() => void workspace.authenticate("register")}
              >
                認証デバイスを登録
              </button>
              <button
                class="quiet-button"
                disabled={workspace.authentication.pending()}
                onClick={() => {
                  if (window.confirm("保存済みのログイン情報と認証デバイスの鍵を削除しますか？"))
                    void workspace.authenticate("logout");
                }}
              >
                ログアウト
              </button>
            </div>
          </details>
          <Progress
            pending={workspace.authentication.pending()}
            error={workspace.authentication.error()}
            status={workspace.authentication.status()}
          />
          <Show when={workspace.auth().status !== "authenticated"}>
            <p class="meta">保存済みの講義・教材はログイン前も閲覧できます。</p>
          </Show>
        </section>
      </aside>
      <main id="main-content" class="main-content" tabindex="-1">
        <Loading
          on={location.pathname}
          fallback={
            <>
              <PageHeader title="読み込み中" />
              <div class="page-content">
                <Progress pending={true} error="" />
              </div>
            </>
          }
        >
          {props.children}
        </Loading>
      </main>
    </div>
  );
}
