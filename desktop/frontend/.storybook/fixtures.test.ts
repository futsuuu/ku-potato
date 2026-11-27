import { expect, it, vi } from "vite-plus/test";
import {
  course,
  createStoryAPI,
  folders,
  material,
  report,
  reportMaterial,
  resources,
} from "./fixtures";

vi.mock("storybook/actions", () => ({ action: () => vi.fn() }));

it("assigns unique material IDs to their owning courses", async () => {
  const api = createStoryAPI();
  const ids: string[] = [];
  for (const course of await api.courses("auto")) {
    if (course.availability !== "available") continue;
    const materials = await api.materials(course.lmsCourseId, "auto");
    expect(materials.lmsCourseId).toBe(course.lmsCourseId);
    for (const material of materials.folders.flatMap((folder) => folder.materials)) {
      ids.push(material.lmsMaterialId);
      const detail = await api.detail(material.lmsMaterialId, "auto");
      expect(detail.course).toEqual(course);
      expect(detail.material).toEqual(material);
    }
  }
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
});

it("preserves the original course material and report fixtures", async () => {
  const api = createStoryAPI();
  expect(await api.materials(course.lmsCourseId, "auto")).toEqual({
    lmsCourseId: course.lmsCourseId,
    folders,
  });
  expect(await api.detail(material.lmsMaterialId, "auto")).toEqual({ course, material, resources });
  expect(await api.detail(reportMaterial.lmsMaterialId, "auto")).toEqual({
    course,
    material: reportMaterial,
    report,
    resources: [],
  });
});

it("lists assignments with matching course folders and material details", async () => {
  const api = createStoryAPI();
  const { assignments } = await api.assignments("auto");
  expect(assignments.length).toBeGreaterThan(0);
  for (const assignment of assignments) {
    const { folders } = await api.materials(assignment.lmsCourseId, "auto");
    expect(
      folders
        .find((folder) => folder.name === assignment.folderName)
        ?.materials.find(
          (material) => material.lmsMaterialId === assignment.material.lmsMaterialId,
        ),
    ).toEqual(assignment.material);
    const detail = await api.detail(assignment.material.lmsMaterialId, "auto");
    expect(detail.course).toMatchObject({
      availability: "available",
      lmsCourseId: assignment.lmsCourseId,
    });
    expect(detail.material).toEqual(assignment.material);
  }
});

it("rejects unknown material IDs instead of returning an unrelated material", async () => {
  await expect(createStoryAPI().detail("missing-material", "auto")).rejects.toThrow(
    "Unknown story material: missing-material",
  );
});
