import { untrack } from "solid-js";
import { createRouter, memoryHistory } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { pageRoutes } from "virtual:file-routes";
import type { API } from "../src/api";
import { WorkspaceProvider } from "../src/workspace";
import Layout from "../src/components/Layout";
import WindowFrame from "../src/components/WindowFrame";

export const pageParameters = {
  layout: "fullscreen",
  controls: { disable: true },
  docs: { story: { inline: false, height: "800px" } },
};

export default function WorkspaceStory(props: { path: string; api: API }) {
  const Router = createRouter({
    routes: fileRoutes(pageRoutes),
    history: memoryHistory(untrack(() => props.path)),
    scrollRestoration: false,
  });
  return (
    <WindowFrame>
      <WorkspaceProvider api={props.api}>
        <Router>{(route) => <Layout>{route.children}</Layout>}</Router>
      </WorkspaceProvider>
    </WindowFrame>
  );
}
