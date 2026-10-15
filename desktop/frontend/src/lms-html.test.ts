// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";
import { compactFolderDescriptionHtml } from "./lms-html";

it("replaces consecutive folder description breaks with one small gap", () => {
  const element = document.createElement("div");
  element.innerHTML = compactFolderDescriptionHtml(
    "<p>前<br> \n <br><br>後<br>単独</p><script>alert(1)</script>",
  );

  const paragraph = element.querySelector("p")!;
  const gap = paragraph.querySelector(".folder-description-gap")!;
  expect(paragraph.querySelectorAll(".folder-description-gap")).toHaveLength(1);
  expect(paragraph.querySelectorAll("br")).toHaveLength(1);
  expect(gap.previousSibling?.textContent).toBe("前");
  expect(gap.nextSibling?.textContent).toBe("後");
  expect(element.querySelector("script")).toBeNull();
});
