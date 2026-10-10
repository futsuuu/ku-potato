(() =>
  [...document.querySelectorAll("tr.accordionHeader")].map((row) => {
    const text = (e) => (e?.textContent || "").replace(/\s+/g, " ").trim();
    if (!row.querySelector(".courseFolderName") || !row.nextElementSibling) {
      throw new Error("Invalid material folder");
    }
    return {
      name: text(row.querySelector(".courseFolderName")),
      date: text(row.querySelector("td.checkStBoldJyugyoDy")),
      materials: [...row.nextElementSibling.querySelectorAll("td.kyozaititleCell")].map((cell) => ({
        id: cell.id,
        name: text(cell),
        type: cell.querySelector("i[title]")?.getAttribute("title"),
        deadline: text(cell.nextElementSibling),
        linked: !!cell.querySelector("a"),
      })),
    };
  }))();
