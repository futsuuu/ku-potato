import { createEffect, Show } from "solid-js";
import { createRouter, hashHistory } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { pageRoutes } from "virtual:file-routes";
import { createAPI, type API } from "./api";
import { createOperation } from "./operation";
import { isDesktop, serverURL } from "./native";
import { WorkspaceProvider } from "./workspace";
import Layout from "./components/Layout";
import WindowFrame from "./components/WindowFrame";
import ConnectionScreen from "./components/ConnectionScreen";
import "virtual:app-fonts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";

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
    <WindowFrame>
      <Show
        when={connection.data()}
        fallback={
          <ConnectionScreen
            pending={connection.pending()}
            error={connection.error()}
            onReload={() => window.location.reload()}
          />
        }
      >
        {(api) => (
          <WorkspaceProvider api={api()}>
            <Router>{(props) => <Layout>{props.children}</Layout>}</Router>
          </WorkspaceProvider>
        )}
      </Show>
    </WindowFrame>
  );
}
