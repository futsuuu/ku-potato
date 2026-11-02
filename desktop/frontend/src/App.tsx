import { createEffect, Show } from "solid-js";
import { createRouter, hashHistory } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { pageRoutes } from "virtual:file-routes";
import { createAPI, type API } from "./api";
import { createOperation } from "./operation";
import { isDesktop, serverURL } from "./native";
import { WorkspaceProvider } from "./workspace";
import Layout from "./components/Layout";
import Progress from "./components/Progress";
import "virtual:app-fonts";
import "virtual:uno.css";

const Router = createRouter({
  routes: fileRoutes(pageRoutes),
  history: isDesktop() ? hashHistory() : undefined,
});

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
        <div class="grid justify-items-start gap-lg p-page">
          <span class="block">KU-POTATO</span>
          <Progress pending={connection.pending()} error={connection.error()} />
          <Show when={connection.error()}>
            <button class="app-button" onClick={() => window.location.reload()}>
              再読み込み
            </button>
          </Show>
        </div>
      }
    >
      {(api) => (
        <WorkspaceProvider api={api()}>
          <Router>{(props) => <Layout>{props.children}</Layout>}</Router>
        </WorkspaceProvider>
      )}
    </Show>
  );
}
