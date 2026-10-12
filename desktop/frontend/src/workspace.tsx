import { createContext, createEffect, createSignal, untrack, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { API, Result, Schema, Sync } from "./api";
import { createOperation } from "./operation";

function createWorkspace(api: API) {
  const [auth, setAuth] = createSignal<Schema["AuthState"]>({ status: "unknown" });
  const courses = createOperation<Result<"listCourses">>();
  const authentication = createOperation<Schema["AuthState"]>();
  const loadCourses = (sync: Sync) => courses.run((observe) => api.courses(sync, observe));
  async function authenticate(kind: "login" | "check" | "logout" | "register") {
    const state = await authentication.run(async (observe) => {
      if (kind === "register") {
        await api.register(observe);
        return api.auth();
      }
      return api[kind](observe);
    });
    if (state) {
      setAuth(state);
      if (kind === "login") void loadCourses("true");
    }
  }
  createEffect(
    () => true,
    () => {
      void api
        .auth()
        .then(setAuth)
        .catch(() => {});
      void loadCourses("auto");
    },
  );
  return {
    api,
    auth,
    courses,
    authentication,
    authenticate,
    loadCourses,
    courseName: (id: string) =>
      courses.data()?.find((course) => course.lmsCourseId === id)?.name ?? id,
  };
}

const WorkspaceContext = createContext<ReturnType<typeof createWorkspace>>();

export function WorkspaceProvider(props: { api: API; children: JSX.Element }) {
  const workspace = createWorkspace(untrack(() => props.api));
  return <WorkspaceContext value={workspace}>{props.children}</WorkspaceContext>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

export const coursePath = (id: string) => `/courses/${encodeURIComponent(id)}`;
export const materialPath = (courseId: string, materialId: string) =>
  `${coursePath(courseId)}/materials/${encodeURIComponent(materialId)}`;

export function decodeRouteParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
