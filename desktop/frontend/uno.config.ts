import { defineConfig, presetIcons, presetMini, type PresetMiniTheme } from "unocss";

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
  canvas: "#171a20",
  ink: "#e6e9ef",
  muted: "#a1a8b4",
  accent: "#a2b5ce",
  line: "#383e49",
  surface: "#242932",
  danger: "#fca5a5",
} satisfies Record<keyof typeof lightColors, string>;

const sidebarWidth = "15rem";
const toolbarHeight = "4rem";
const sectionSpacing = "1.5rem";
const xlSpacing = "2rem";

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
    linkUnderline: "color-mix(in srgb, currentColor 35%, transparent)",
    frosted: "color-mix(in srgb, var(--app-canvas) 85%, transparent)",
  },
  spacing: {
    none: "0",
    xs: "0.25rem",
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    section: sectionSpacing,
    xl: xlSpacing,
    page: "2.5rem",
    toolbar: toolbarHeight,
    sidebar: sidebarWidth,
    content: `calc(${toolbarHeight} + ${xlSpacing})`,
    contentCompact: `calc(${toolbarHeight} + ${sectionSpacing})`,
  },
  width: { sidebar: sidebarWidth },
  maxWidth: { content: "76rem" },
  height: { viewport: "100dvh" },
  minHeight: { toolbar: toolbarHeight },
  maxHeight: { sidebar: "30dvh" },
  zIndex: { action: "1", header: "2", skip: "20" },
  fontFamily: { sans: '"Gen Interface JP", system-ui, sans-serif' },
  fontSize: {
    body: "0.9375rem",
    small: "0.8125rem",
    title: "1.375rem",
    heading: "1.125rem",
  },
  fontWeight: { normal: "400", bold: "700" },
  lineHeight: { body: "1.5", heading: "1.2" },
  borderRadius: { none: "0", control: "0" },
  lineWidth: { none: "0", thin: "1px", focus: "2px" },
  breakpoints: { sm: "640px", md: "896px" },
} satisfies PresetMiniTheme;

// Keep the blur radius fixed; fade the entire backdrop's opacity with the mask.
const backdropFadeMask =
  "linear-gradient(to bottom, black 40%, rgb(0 0 0 / 0.972) 46%, rgb(0 0 0 / 0.896) 52%, rgb(0 0 0 / 0.784) 58%, rgb(0 0 0 / 0.648) 64%, rgb(0 0 0 / 0.5) 70%, rgb(0 0 0 / 0.352) 76%, rgb(0 0 0 / 0.216) 82%, rgb(0 0 0 / 0.104) 88%, rgb(0 0 0 / 0.028) 94%, transparent 100%)";

const names = (...scales: object[]) => scales.flatMap(Object.keys);
const restrict = (prefix: string, tokens: string[]) =>
  new RegExp(
    `(?:^|:)(?!(?:${prefix})-(?:${tokens.join("|")}|inherit|transparent|current|none|auto)$)(?:${prefix})-.+`,
  );

const gridColumns = {
  asymmetric: "minmax(0, 5fr) minmax(0, 4fr)",
  single: "minmax(0, 1fr)",
  pair: "repeat(2, minmax(0, 1fr))",
  "key-value": "max-content minmax(0, 1fr)",
};

export default defineConfig<PresetMiniTheme>({
  presets: [
    presetMini(),
    presetIcons({
      scale: 1.25,
      extraProperties: {
        display: "inline-block",
        "flex-shrink": "0",
        opacity: "0.7",
      },
    }),
  ],
  theme,
  rules: [
    ["list-none", { "list-style": "none" }],
    ["tnum", { "font-variant-numeric": "tabular-nums" }],
    ["break-anywhere", { "overflow-wrap": "anywhere" }],
    ["budoux-text", { "word-break": "keep-all", "overflow-wrap": "anywhere" }],
    ["border-collapse", { "border-collapse": "collapse" }],
    ["opacity-opaque", { opacity: "1" }],
    [
      "backdrop-blur-soft",
      { "backdrop-filter": "blur(12px)", "-webkit-backdrop-filter": "blur(12px)" },
    ],
    [
      "mask-fade-bottom",
      { "mask-image": backdropFadeMask, "-webkit-mask-image": backdropFadeMask },
    ],
    ["translate-y-outside", { transform: "translateY(-200%)" }],
    [
      "underlined-link",
      {
        "text-decoration-line": "underline",
        "text-decoration-color": theme.colors.linkUnderline,
        "text-decoration-thickness": theme.lineWidth.thin,
        "text-underline-offset": theme.lineWidth.focus,
      },
    ],
    [
      "table-cell-bordered",
      {
        padding: theme.spacing.sm,
        border: `${theme.lineWidth.thin} solid ${theme.colors.line}`,
        "text-align": "left",
      },
    ],
    [
      /^grid-cols-(.+)$/,
      ([, token]) => {
        const value = gridColumns[token as keyof typeof gridColumns];
        return value ? { "grid-template-columns": value } : undefined;
      },
    ],
    [
      /^scroll-pt-(.+)$/,
      ([, token], context) => {
        const value = context.theme.spacing?.[token];
        return value ? { "scroll-padding-top": value } : undefined;
      },
    ],
  ],
  shortcuts: {
    "page-content":
      "min-h-none flex-auto overflow-auto px-page pb-xl pt-content scroll-pt-content lt-md:px-section lt-md:pb-section lt-md:pt-contentCompact lt-md:scroll-pt-contentCompact [&>*]:max-w-content",
    "app-button":
      "inline-flex items-center justify-center gap-sm border-thin border-line rounded-none border-solid bg-canvas px-md py-sm text-small font-normal disabled:cursor-default hover:bg-surface disabled:text-muted",
    "muted-note": "block text-small text-muted",
    "no-content": "py-xl text-small text-muted",
    "error-message": "break-words py-md text-small text-danger",
    "item-list": "m-none border-t-thin border-line border-solid p-none list-none",
    "section-intro": "mb-section flex items-baseline justify-between gap-lg",
    "item-link":
      "flex items-center justify-between gap-lg border-b-thin border-line border-solid p-section text-ink",
    "linked-item":
      "hover:bg-surface focus-visible:text-accent hover:text-accent [&_.link-label]:underlined-link",
  },
  // Allow selector variants, but keep arbitrary values and numeric scales disabled.
  blocklist: [
    /\[(?!&|current=page\]|href\])|[$#]|\d/,
    restrict("bg|c|color|fill|stroke|ring|decoration|accent|caret", names(theme.colors)),
    restrict("outline", [
      ...names(theme.colors, theme.lineWidth),
      "solid",
      "dashed",
      "dotted",
      "double",
      "offset-focus",
    ]),
    restrict("text", [
      ...names(theme.colors, theme.fontSize),
      ..."left right center justify start end wrap nowrap balance pretty ellipsis clip truncate".split(
        " ",
      ),
    ]),
    restrict("font", names(theme.fontFamily, theme.fontWeight)),
    restrict("leading", names(theme.lineHeight)),
    restrict("rounded(?:-[trblse]{1,2})?", names(theme.borderRadius)),
    restrict("(?:border|b)(?:-[trblxyse])?", [
      ...names(theme.colors, theme.lineWidth),
      "solid",
      "dashed",
      "dotted",
      "double",
      "collapse",
    ]),
    restrict(
      "[mp][xytrblse]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|translate(?:-[xy])?|scroll-pt",
      [...names(theme.spacing, theme.width), "outside"],
    ),
    restrict("(?:min-|max-)?[wh]", [
      ...names(theme.width, theme.maxWidth, theme.height, theme.minHeight, theme.maxHeight),
      "full",
      "screen",
      "fit",
      "min",
      "max",
    ]),
    restrict("z", names(theme.zIndex)),
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
        font-synthesis: none;
        text-autospace: normal;
        color: ${theme.colors.ink};
        background: ${theme.colors.canvas};
      }
      @media (prefers-color-scheme: dark) {
        :root { ${colorVariables(darkColors)} }
      }
      * { box-sizing: border-box; border-width: ${theme.lineWidth.none}; }
      body { margin: ${theme.spacing.none}; overflow: hidden; }
      button, a { -webkit-tap-highlight-color: transparent; }
      button { font: inherit; color: inherit; cursor: pointer; background: transparent; border: ${theme.lineWidth.none}; padding: ${theme.spacing.none}; }
      button:disabled { cursor: default; }
      a { color: inherit; text-decoration: none; }
      a:focus-visible, button:focus-visible, summary:focus-visible { outline: ${theme.lineWidth.focus} solid ${theme.colors.accent}; outline-offset: ${theme.lineWidth.focus}; }
      main:focus { outline: none; }
      h1, h2, h3, p { margin: ${theme.spacing.none}; }
      h1 { font-weight: ${theme.fontWeight.bold}; font-size: ${theme.fontSize.title}; }
      h2, h3 { font-weight: ${theme.fontWeight.normal}; font-size: ${theme.fontSize.heading}; }
      h1, h2, h3 { line-height: ${theme.lineHeight.heading}; overflow-wrap: anywhere; }
      summary { cursor: pointer; color: ${theme.colors.muted}; }
    `,
    },
  ],
});
