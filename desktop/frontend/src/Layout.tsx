import { createEffect, Loading } from "solid-js";
import { useLocation } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import { useWorkspace } from "./workspace";
import Progress from "./Progress";
import PageHeader from "./PageHeader";
import Authentication from "./Authentication";

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
        <div class="mt-auto flex flex-col gap-section">
          <Authentication
            api={workspace.api}
            title="工学院 統合認証"
            onLogin={() => void workspace.loadCourses("true")}
          >
            <p class="meta">保存済みの講義・教材はログイン前も閲覧できます。</p>
          </Authentication>
          <Authentication api={workspace.api.google} title="Google（@g.kogakuin.jp）" />
        </div>
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
