(() =>
  [...document.querySelectorAll(".lms-weekly-area .lms-cardname")].map((card) => {
    const a = card.querySelector("a");
    return {
      name: (card.textContent || "").replace(/\s+/g, " ").trim(),
      linked: !!a,
      handler: a?.getAttribute("onclick"),
    };
  }))();
