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
  },
  spacing: {
    none: "0",
    xs: "0.25rem",
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    section: "1.5rem",
    xl: "2rem",
    page: "2.5rem",
    toolbar: "4rem",
    navigation: "4rem",
  },
  width: { sidebar: "15rem", icon: "1.125rem" },
  maxWidth: { content: "76rem" },
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

const names = (...scales: object[]) => scales.flatMap(Object.keys);
const restrict = (prefix: string, tokens: string[]) =>
  new RegExp(
    `(?:^|:)(?!(?:${prefix})-(?:${tokens.join("|")}|inherit|transparent|current|none|auto)$)(?:${prefix})-.+`,
  );

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
  variants: [
    (matcher) =>
      matcher.startsWith("report-links:")
        ? {
            matcher: matcher.slice("report-links:".length),
            selector: (selector) => `${selector} a[href]::after`,
          }
        : undefined,
  ],
  shortcuts: {
    app: "overflow-hidden",
    sidebar:
      "min-h-none p-section border-r-thin border-solid border-line bg-canvas flex flex-col gap-xl overflow-y-auto",
    auth: "pt-section border-t-thin border-solid border-line flex flex-col gap-md text-small",
    "app-button":
      "inline-flex items-center justify-center gap-sm px-md py-sm border-thin border-solid border-line rounded-none bg-canvas text-small font-normal disabled:text-muted disabled:cursor-default hover:bg-surface",
    "quiet-button":
      "inline-flex items-center gap-sm py-xs text-left text-small text-muted hover:text-ink disabled:cursor-default",
    list: "p-none m-none list-none",
    row: "py-section border-b-thin border-solid border-line flex flex-col gap-md",
    "row-main": "flex items-center justify-between gap-md",
    "item-link":
      "flex items-center justify-between gap-lg p-section border-b-thin border-solid border-line text-ink",
    "item-content": "min-w-none flex flex-col gap-xs",
    meta: "block text-small text-muted",
    tag: "text-small text-muted",
    actions: "flex flex-wrap gap-sm",
    progress: "flex flex-wrap gap-sm py-sm text-small text-muted",
    error: "text-small text-danger break-words",
    empty: "py-xl text-small text-muted",
  },
  rules: [
    ["list-none", { "list-style": "none" }],
    ["tnum", { "font-variant-numeric": "tabular-nums" }],
  ],
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
      .app { display: grid; grid-template-columns: ${theme.width.sidebar} minmax(0, 1fr); height: 100dvh; }
      button, a { -webkit-tap-highlight-color: transparent; }
      button { font: inherit; color: inherit; cursor: pointer; background: transparent; border: ${theme.lineWidth.none}; padding: ${theme.spacing.none}; }
      button:disabled { cursor: default; }
      a { color: inherit; text-decoration: none; }
      a:focus-visible, button:focus-visible, summary:focus-visible { outline: ${theme.lineWidth.focus} solid ${theme.colors.accent}; outline-offset: ${theme.lineWidth.focus}; }
      main:focus { outline: none; }
      h1, h2, h3, p { margin: ${theme.spacing.none}; }
      h1 { font-weight: ${theme.fontWeight.bold}; }
      h2, h3 { font-weight: ${theme.fontWeight.normal}; }
      h1, h2, h3 { line-height: ${theme.lineHeight.heading}; overflow-wrap: anywhere; }
      h1 { font-size: ${theme.fontSize.title}; }
      h2, h3 { font-size: ${theme.fontSize.heading}; }
      summary { cursor: pointer; color: ${theme.colors.muted}; }
      .main-content { min-width: ${theme.spacing.none}; min-height: ${theme.spacing.none}; display: flex; flex-direction: column; }
      .page-header { flex-shrink: 0; min-height: ${theme.spacing.toolbar}; padding: ${theme.spacing.lg} ${theme.spacing.page}; background: ${theme.colors.canvas}; border-bottom: ${theme.lineWidth.thin} solid ${theme.colors.line}; display: flex; align-items: center; justify-content: space-between; gap: ${theme.spacing.lg}; }
      .header-title { min-width: ${theme.spacing.none}; display: flex; align-items: center; gap: ${theme.spacing.lg}; }
      .page-header h1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .page-header .actions { flex-shrink: 0; }
      .parent-link { display: inline-block; margin-bottom: ${theme.spacing.section}; color: ${theme.colors.muted}; font-size: ${theme.fontSize.small}; }
      .parent-link, a.course-link .link-label, a.item-link .link-label, .resource-link .link-label, .report-content a[href] { text-decoration: underline; text-decoration-color: ${theme.colors.linkUnderline}; text-decoration-thickness: ${theme.lineWidth.thin}; text-underline-offset: ${theme.lineWidth.focus}; }
      .parent-link:hover, .parent-link:focus-visible, .report-content a[href]:hover, .report-content a[href]:focus-visible { color: ${theme.colors.accent}; }
      .page-content { flex: 1; min-height: ${theme.spacing.none}; overflow: auto; padding: ${theme.spacing.xl} ${theme.spacing.page}; }
      .page-content > * { max-width: ${theme.maxWidth.content}; }
      .section-intro { display: flex; align-items: baseline; justify-content: space-between; gap: ${theme.spacing.lg}; margin-bottom: ${theme.spacing.section}; }
      .brand { display: block; }
      .navigation { display: grid; }
      .nav-link { display: flex; align-items: center; gap: ${theme.spacing.md}; padding: ${theme.spacing.md} ${theme.spacing.sm}; border-bottom: ${theme.lineWidth.thin} solid ${theme.colors.line}; font-size: ${theme.fontSize.small}; }
      .nav-link:hover { background: ${theme.colors.surface}; }
      .nav-link[aria-current="page"] { color: ${theme.colors.accent}; border-bottom-color: ${theme.colors.accent}; }
      .auth-settings { display: grid; gap: ${theme.spacing.sm}; margin-top: ${theme.spacing.sm}; }
      .course-link { display: flex; align-items: center; justify-content: space-between; gap: ${theme.spacing.lg}; padding: ${theme.spacing.lg} ${theme.spacing.section}; border-bottom: ${theme.lineWidth.thin} solid ${theme.colors.line}; }
      .course-count { margin-bottom: ${theme.spacing.section}; }
      .course-section { margin-bottom: ${theme.spacing.xl}; }
      .course-section h2 { margin-bottom: ${theme.spacing.md}; }
      a.course-link:hover, a.item-link:hover { background: ${theme.colors.surface}; color: ${theme.colors.accent}; }
      a.course-link:focus-visible, a.item-link:focus-visible { color: ${theme.colors.accent}; }
      .resource-row { position: relative; padding-left: ${theme.spacing.section}; padding-right: ${theme.spacing.section}; }
      .resource-link { display: inline; }
      .external-link-icon { margin-left: ${theme.spacing.xs}; vertical-align: middle; }
      .report-content a[href]::after { content: ""; margin-left: ${theme.spacing.xs}; vertical-align: middle; }
      .resource-link::after { content: ""; position: absolute; inset: ${theme.spacing.none}; }
      .resource-row:has(.resource-link):hover { background: ${theme.colors.surface}; }
      .resource-row:has(.resource-link):hover .resource-link, .resource-link:focus-visible { color: ${theme.colors.accent}; }
      .resource-row:has(.resource-link:focus-visible) { outline: ${theme.lineWidth.focus} solid ${theme.colors.accent}; outline-offset: ${theme.lineWidth.focus}; }
      .resource-row .actions button { position: relative; z-index: 1; }
      .list { border-top: ${theme.lineWidth.thin} solid ${theme.colors.line}; }
      .item-content { overflow-wrap: anywhere; }
      .folder-section { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 3fr); border-top: ${theme.lineWidth.thin} solid ${theme.colors.line}; }
      .folder-section > .list { border-top: none; display: flex; flex-direction: column; }
      .folder-section > .list > li:last-child { flex: 1; display: flex; flex-direction: column; }
      .folder-section > .list > li:last-child > .item-link { flex: 1; border-bottom-width: ${theme.lineWidth.none}; }
      .folder-heading { padding: ${theme.spacing.section} ${theme.spacing.lg} ${theme.spacing.section} ${theme.spacing.none}; }
      .folder-heading .meta { margin-top: ${theme.spacing.sm}; }
      .report-section { margin-top: ${theme.spacing.section}; }
      .report-section h2 { margin-bottom: ${theme.spacing.md}; }
      .report-metadata { margin: ${theme.spacing.section} ${theme.spacing.none}; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: ${theme.spacing.sm} ${theme.spacing.section}; }
      .report-metadata dt { color: ${theme.colors.muted}; }
      .report-metadata dd { margin: ${theme.spacing.none}; overflow-wrap: anywhere; }
      .report-content { overflow-wrap: anywhere; }
      .report-content > * + * { margin-top: ${theme.spacing.md}; }
      .report-content pre { white-space: pre-wrap; }
      .report-content table { border-collapse: collapse; max-width: 100%; }
      .report-content th, .report-content td { padding: ${theme.spacing.sm}; border: ${theme.lineWidth.thin} solid ${theme.colors.line}; text-align: left; }
      .progress, .error { padding: ${theme.spacing.md} ${theme.spacing.none}; }
      .connection-state { display: grid; justify-items: start; gap: ${theme.spacing.lg}; padding: ${theme.spacing.page}; }
      .skip-link { position: fixed; top: ${theme.spacing.sm}; left: ${theme.spacing.sm}; z-index: 20; padding: ${theme.spacing.sm} ${theme.spacing.lg}; background: ${theme.colors.canvas}; transform: translateY(-200%); }
      .skip-link:focus { transform: none; }
      @media (max-width: ${theme.breakpoints.md}) {
        .sidebar { padding: ${theme.spacing.lg}; }
        .page-header { padding-left: ${theme.spacing.section}; padding-right: ${theme.spacing.section}; }
        .page-content { padding: ${theme.spacing.section}; }
        .folder-section { grid-template-columns: minmax(0, 1fr); }
        .folder-heading { padding-bottom: ${theme.spacing.md}; }
      }
      @media (max-width: ${theme.breakpoints.sm}) {
        .app { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
        .sidebar { max-height: 30dvh; padding: ${theme.spacing.section}; border-right: none; border-bottom: ${theme.lineWidth.thin} solid ${theme.colors.line}; gap: ${theme.spacing.section}; }
        .navigation { grid-template-columns: repeat(2, minmax(0, 1fr)); background: ${theme.colors.canvas}; }
        .nav-link { justify-content: center; }
        .auth { margin-top: ${theme.spacing.none}; }
        .page-header { padding: ${theme.spacing.md} ${theme.spacing.lg}; }
        .header-title { gap: ${theme.spacing.sm}; }
        .page-header h1 { font-size: ${theme.fontSize.heading}; }
      }
    `,
    },
  ],
});
