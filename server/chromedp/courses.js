(() =>
  [...document.querySelectorAll(".lms-weekly-area .lms-cardname")].map((card) => {
    const a = card.querySelector("a");
    const info = card.closest(".lms-card")?.querySelector(".courseCardInfo");
    return {
      name: (card.textContent || "").replace(/\s+/g, " ").trim(),
      linked: !!a,
      handler: a?.getAttribute("onclick"),
      category:
        card.closest(".lms-daybox")?.querySelector(".lms-category-title")?.textContent?.trim() ||
        "",
      period: [...(info?.childNodes || [])]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join("")
        .trim(),
    };
  }))();
