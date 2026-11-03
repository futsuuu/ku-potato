import { createEffect, Loading } from "solid-js";
import BookOpen from "@lucide/solid/icons/book-open";
import CalendarClock from "@lucide/solid/icons/calendar-clock";
import { useLocation } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import { useWorkspace } from "../workspace";
import Progress from "./Progress";
import PageHeader from "./PageHeader";
import Authentication from "./Authentication";

function NavigationLink(props: {
  href: string;
  current: boolean;
  icon: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <a class="navigation-link" href={props.href} aria-current={props.current ? "page" : undefined}>
      {props.icon}
      {props.children}
    </a>
  );
}

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
    <div class="app-layout">
      <button class="skip-link" onClick={() => document.getElementById("main-content")?.focus()}>
        本文へ移動
      </button>
      <aside class="sidebar">
        <a class="app-brand" href="/" aria-label="KU-POTATO 講義一覧">
          KU-POTATO
        </a>
        <nav class="app-navigation" aria-label="ナビゲーション">
          <NavigationLink
            href="/"
            current={location.pathname === "/" || location.pathname.startsWith("/courses/")}
            icon={<BookOpen class="icon" aria-hidden="true" />}
          >
            講義・教材
          </NavigationLink>
          <NavigationLink
            href="/assignments"
            current={location.pathname === "/assignments"}
            icon={<CalendarClock class="icon" aria-hidden="true" />}
          >
            期限前の課題
          </NavigationLink>
        </nav>
        <div class="sidebar-authentication">
          <Authentication
            api={workspace.api}
            title="工学院 統合認証"
            onLogin={() => void workspace.loadCourses("true")}
          >
            <p class="muted-note">保存済みの講義・教材はログイン前も閲覧できます。</p>
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
