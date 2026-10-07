import presetMini, { type Theme } from "@unocss/preset-mini";
import { defineConfig } from "unocss";

export const theme = {
    colors: {
        canvas: "#fdfdff",
        ink: "#081f38",
        muted: "#9fa5ab",
        accent: "#1c73d0",
        line: "#dddddd",
    },
    spacing: { none: "0", xs: "0.25rem", sm: "0.5rem", md: "0.75rem", lg: "1rem", xl: "2rem" },
    maxWidth: { content: "56rem" },
    fontFamily: { sans: 'Inter, Arial, "Noto Sans JP", system-ui, sans-serif' },
    fontSize: { body: "1rem", small: "0.833rem", title: "2rem", heading: "1.5rem" },
    fontWeight: { normal: "400", bold: "700" },
    lineHeight: { body: "1.5", heading: "1.2" },
    borderRadius: { none: "0", control: "0.25rem" },
    lineWidth: { none: "0", thin: "1px" },
    breakpoints: { sm: "640px", md: "896px" },
} satisfies Theme;

const shortcuts = {
    "app-page": "mx-auto max-w-content px-lg py-xl",
    "app-header": "flex items-center justify-between gap-lg",
    "app-button":
        "flex-none px-md py-sm rounded-control border-thin border-solid border-line bg-canvas text-ink disabled:text-muted disabled:cursor-not-allowed",
    "app-list": "p-none list-none",
    "app-row": "py-md border-b-thin border-b-solid border-line",
    "app-meta": "block mt-xs text-small text-muted break-anywhere",
};

const names = (...scales: object[]) => scales.flatMap(Object.keys);
const restrict = (prefix: string, tokens: string[]) =>
    new RegExp(`(?:^|:)(?:${prefix})-(?!(?:${tokens.join("|")}|inherit|transparent|current|none|auto)$).+`);

export default defineConfig<Theme>({
    presets: [presetMini()],
    content: { pipeline: { include: [/desktop\/client\/.*\.[jt]sx?$/] } },
    theme,
    shortcuts,
    // Mini does not include list-style or screen-reader-only utilities.
    rules: [
        ["list-none", { "list-style": "none" }],
        ["sr-only", {
            position: "absolute",
            width: theme.lineWidth.thin,
            height: theme.lineWidth.thin,
            padding: theme.spacing.none,
            margin: `-${theme.lineWidth.thin}`,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            "white-space": "nowrap",
            "border-width": theme.lineWidth.none,
        }],
    ],
    // Keep structural Mini utilities; require named tokens for the design scales.
    blocklist: [
        /[[\]$#]|\d/,
        restrict("bg|c|color|fill|stroke|ring|outline|decoration|accent|caret", names(theme.colors)),
        restrict("text", [
            ...names(theme.colors, theme.fontSize),
            ..."left right center justify start end wrap nowrap balance pretty ellipsis clip truncate".split(" "),
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
        restrict("(?:min-|max-)?[wh]", [...names(theme.maxWidth), "full", "screen", "fit", "min", "max"]),
    ],
    preflights: [{
        getCSS: () => `
            :root {
                font-family: ${theme.fontFamily.sans};
                font-size: ${theme.fontSize.body};
                line-height: ${theme.lineHeight.body};
                text-autospace: normal;
                color: ${theme.colors.ink};
                background: ${theme.colors.canvas};
            }
            body { margin: ${theme.spacing.none}; }
            button { font: inherit; }
            a { color: ${theme.colors.accent}; text-underline-offset: ${theme.spacing.xs}; }
            h1, h2 { line-height: ${theme.lineHeight.heading}; font-weight: ${theme.fontWeight.bold}; }
            h1 { font-size: ${theme.fontSize.title}; }
            h2 { font-size: ${theme.fontSize.heading}; }
        `,
    }],
});
