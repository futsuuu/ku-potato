import { defineConfig, presetMini, type PresetMiniTheme } from "unocss";

const lightColors = {
  canvas: "#fdfdff",
  ink: "#081f38",
  muted: "#596979",
  accent: "#1c73d0",
  line: "#dddddd",
  surface: "#f4f7fb",
  danger: "#b91c1c",
};

const darkColors = {
  canvas: "#101820",
  ink: "#e6edf5",
  muted: "#a4b4c5",
  accent: "#7cb9ff",
  line: "#394a5c",
  surface: "#182431",
  danger: "#fca5a5",
} satisfies Record<keyof typeof lightColors, string>;

const colorVariables = (colors: typeof lightColors) =>
  Object.entries(colors)
    .map(([name, value]) => `--app-${name}: ${value};`)
    .join("\n");

export const theme = {
  colors: {
    canvas: "var(--app-canvas)",
    ink: "var(--app-ink)",
    muted: "var(--app-muted)",
    accent: "var(--app-accent)",
    line: "var(--app-line)",
    surface: "var(--app-surface)",
    danger: "var(--app-danger)",
  },
  spacing: {
    none: "0",
    xs: "0.25rem",
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    section: "1.5rem",
    xl: "2rem",
  },
  width: { sidebar: "13rem" },
  maxWidth: { content: "56rem" },
  fontFamily: { sans: 'Inter, Arial, "Noto Sans JP", system-ui, sans-serif' },
  fontSize: { body: "1rem", small: "0.833rem", title: "2rem", heading: "1.5rem" },
  fontWeight: { normal: "400", bold: "700" },
  lineHeight: { body: "1.5", heading: "1.2" },
  borderRadius: { none: "0", control: "0.25rem" },
  lineWidth: { none: "0", thin: "1px", focus: "2px" },
  breakpoints: { sm: "640px", md: "896px" },
} satisfies PresetMiniTheme;

const names = (...scales: object[]) => scales.flatMap(Object.keys);
const restrict = (prefix: string, tokens: string[]) =>
  new RegExp(
    `(?:^|:)(?!(?:${prefix})-(?:${tokens.join("|")}|inherit|transparent|current|none|auto)$)(?:${prefix})-.+`,
  );

export default defineConfig<PresetMiniTheme>({
  presets: [presetMini()],
  theme,
  shortcuts: {
    app: "flex min-h-screen",
    sidebar:
      "sticky top-none h-screen w-sidebar flex-none p-lg border-r-thin border-solid border-line flex flex-col gap-section",
    auth: "mt-auto flex flex-col gap-sm text-small",
    "app-button":
      "px-md py-xs border-thin border-solid border-line rounded-control bg-canvas disabled:text-muted disabled:cursor-default hover:bg-surface",
    list: "p-none list-none my-lg",
    row: "py-md border-b-thin border-solid border-line flex flex-col gap-sm",
    "row-main": "flex items-center justify-between gap-md",
    "course-card": "w-full py-md text-left border-b-thin border-solid border-line",
    meta: "block text-small text-muted",
    tag: "text-small text-muted",
    "app-link": "text-left text-accent hover:underline",
    "material-name": "text-body",
    actions: "flex flex-wrap gap-sm",
    progress: "flex flex-wrap gap-sm py-sm text-small text-muted",
    error: "text-small text-danger break-words",
    empty: "py-lg text-small text-muted",
  },
  rules: [["list-none", { "list-style": "none" }]],
  // Keep structural utilities; design scales must use named theme tokens.
  blocklist: [
    /[[\]$#]|\d/,
    restrict("bg|c|color|fill|stroke|ring|outline|decoration|accent|caret", names(theme.colors)),
    restrict("text", [
      ...names(theme.colors, theme.fontSize),
      ..."left right center justify start end wrap nowrap balance pretty ellipsis clip truncate".split(
        " ",
      ),
    ]),
    restrict("font", names(theme.fontFamily, theme.fontWeight)),
    restrict("leading", names(theme.lineHeight)),
    restrict("rounded(?:-[trblse]{1,2})?", names(theme.borderRadius)),
    restrict(
      "(?:border|b)(?:-[trblxyse])?",
      names(theme.colors, theme.lineWidth).concat("solid", "dashed", "dotted", "double"),
    ),
    restrict(
      "[mp][xytrblse]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|translate(?:-[xy])?",
      names(theme.spacing),
    ),
    restrict("(?:min-|max-)?[wh]", [
      ...names(theme.width, theme.maxWidth),
      "full",
      "screen",
      "fit",
      "min",
      "max",
    ]),
  ],
  preflights: [
    {
      getCSS: () => `
      :root {
        ${colorVariables(lightColors)}
        color-scheme: light dark;
        font-family: ${theme.fontFamily.sans};
        font-size: ${theme.fontSize.body};
        line-height: ${theme.lineHeight.body};
        text-autospace: normal;
        color: ${theme.colors.ink};
        background: ${theme.colors.canvas};
      }
      @media (prefers-color-scheme: dark) {
        :root { ${colorVariables(darkColors)} }
      }
      * { box-sizing: border-box; border-width: ${theme.lineWidth.none}; }
      body { margin: ${theme.spacing.none}; }
      button { font: inherit; color: inherit; cursor: pointer; background: transparent; border: ${theme.lineWidth.none}; padding: ${theme.spacing.none}; }
      button:disabled { cursor: default; }
      button:focus-visible, summary:focus-visible { outline: ${theme.lineWidth.focus} solid ${theme.colors.accent}; outline-offset: ${theme.lineWidth.focus}; }
      nav { display: grid; gap: ${theme.spacing.sm}; }
      nav button[aria-current="page"] { font-weight: ${theme.fontWeight.bold}; }
      summary { cursor: pointer; }
      details button { display: block; margin-top: ${theme.spacing.sm}; }
      main { flex: 1; min-width: ${theme.spacing.none}; padding: ${theme.spacing.section}; }
      header { display: flex; align-items: center; justify-content: space-between; gap: ${theme.spacing.lg}; margin: ${theme.spacing.lg} ${theme.spacing.none}; }
      h1, h2 { line-height: ${theme.lineHeight.heading}; font-weight: ${theme.fontWeight.bold}; }
      h1 { font-size: ${theme.fontSize.title}; margin: ${theme.spacing.none}; }
      h2 { font-size: ${theme.fontSize.heading}; margin: ${theme.spacing.section} ${theme.spacing.none} ${theme.spacing.sm}; }
      .course-card small { display: block; color: ${theme.colors.muted}; font-size: ${theme.fontSize.small}; }
    `,
    },
  ],
});
