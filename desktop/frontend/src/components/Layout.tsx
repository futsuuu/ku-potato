import { createEffect, Loading } from "solid-js";
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
    <a
      class="flex items-center gap-md border-b-thin border-line border-solid px-sm py-md text-small lt-sm:justify-center aria-[current=page]:border-b-accent hover:bg-surface aria-[current=page]:text-accent"
      href={props.href}
      aria-current={props.current ? "page" : undefined}
    >
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
    <div class="h-viewport flex overflow-hidden lt-sm:flex-col">
      <button
        class="fixed left-sm top-sm z-skip bg-canvas px-lg py-sm translate-y-outside focus:transform-none"
        onClick={() => document.getElementById("main-content")?.focus()}
      >
        本文へ移動
      </button>
      <aside class="fixed inset-y-none left-none min-h-none w-sidebar flex flex-col gap-xl overflow-y-auto border-r-thin border-line border-solid bg-canvas p-section lt-sm:static lt-sm:max-h-sidebar lt-sm:w-auto lt-sm:gap-section lt-sm:border-b-thin lt-sm:border-r-none lt-md:p-lg lt-sm:p-section">
        <a class="block" href="/" aria-label="KU-POTATO 講義一覧">
          KU-POTATO
        </a>
        <nav class="grid lt-sm:bg-canvas lt-sm:grid-cols-pair" aria-label="ナビゲーション">
          <NavigationLink
            href="/"
            current={location.pathname === "/" || location.pathname.startsWith("/courses/")}
            icon={<span class="i-lucide-book-open" aria-hidden="true" />}
          >
            講義・教材
          </NavigationLink>
          <NavigationLink
            href="/assignments"
            current={location.pathname === "/assignments"}
            icon={<span class="i-lucide-calendar-clock" aria-hidden="true" />}
          >
            期限前の課題
          </NavigationLink>
        </nav>
        <div class="mt-auto flex flex-col gap-section">
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
      <main
        id="main-content"
        class="main-content ml-sidebar min-h-none min-w-none flex flex-auto flex-col overflow-hidden lt-sm:ml-none"
        tabindex="-1"
      >
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
