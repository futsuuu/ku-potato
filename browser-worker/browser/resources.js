(() =>
  [...document.querySelectorAll('td[data-label="資料名"]')].map((cell) => ({
    name: (cell.textContent || "").replace(/\s+/g, " ").trim(),
    kind:
      [...cell.querySelectorAll("[title],img[alt]")]
        .map((e) => e.getAttribute("title") ?? e.getAttribute("alt"))
        .find((s) => s?.endsWith("資料")) ?? "unknown",
    handlers: [...cell.querySelectorAll("a")]
      .flatMap((a) => [a.getAttribute("onclick"), a.getAttribute("href")])
      .filter((s) => s !== null),
  })))();
