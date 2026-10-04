import { createEffect, createSignal, onCleanup } from "solid-js";
import type { QueryError, SyncPolicy } from "../../core/in_port.ts";
import type { DesktopQueryResult } from "../bindings.ts";

const messages: Record<QueryError["reason"], string> = {
    source: "取得に失敗しました。もう一度お試しください。",
    "authentication-required": "ブラウザでログインしてから、もう一度お試しください。",
    "authentication-storage": "ログイン情報を読み込めませんでした。",
    cache: "保存済みのデータを読み込めませんでした。",
    "cache-miss": "データが見つかりません。再取得をお試しください。",
    "material-not-found": "教材が見つかりません。公開が終了した可能性があります。",
};

export function createDesktopQuery<A>(
    key: () => string,
    fetch: (key: string, sync: SyncPolicy) => Promise<DesktopQueryResult<A>>,
) {
    const [data, setData] = createSignal<A | undefined>(undefined);
    const [error, setError] = createSignal("");
    const [pending, setPending] = createSignal(false);
    let request = 0;

    const load = (value: string, sync: SyncPolicy) => {
        const current = ++request;
        setPending(true);
        setError("");
        void Promise.resolve().then(() => fetch(value, sync)).then(
            (result) => {
                if (current !== request) return;
                if (result.status === "success") setData(() => result.data);
                else setError(messages[result.error.reason]);
            },
            () => {
                if (current === request) setError("取得に失敗しました。もう一度お試しください。");
            },
        ).finally(() => {
            if (current === request) setPending(false);
        });
    };

    createEffect(key, (value) => {
        setData(undefined);
        load(value, "auto");
    });
    onCleanup(() => {
        request++;
    });

    return {
        data,
        error,
        pending,
        refresh: () => {
            if (!pending()) load(key(), "true");
        },
    };
}
