import { createContext, createEffect, untrack, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { API, Result, Sync } from "./api";
import { createOperation } from "./operation";

function createWorkspace(api: API) {
  const courses = createOperation<Result<"listCourses">>();
  const loadCourses = (sync: Sync) => courses.run((observe) => api.courses(sync, observe));
  createEffect(
    () => true,
    () => {
      void loadCourses("auto");
    },
  );
  return {
    api,
    courses,
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
