/** Shared contract for Deno-side handlers and the webview's bindings proxy. */
export interface DesktopBindings {
    greet(name: string): Promise<string>;
}
