import { Show } from "solid-js";

export default function QueryStatus(props: { pending: boolean; error: string }) {
    return (
        <>
            <Show when={props.pending}>
                <p role="status">読み込み中… 認証が必要な場合はブラウザでログインしてください。</p>
            </Show>
            <Show when={props.error}>{(message) => <p role="alert">{message()}</p>}</Show>
        </>
    );
}
