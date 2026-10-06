import type {} from "./bindings.d.ts";
import { Loading } from "solid-js";
import { paths, Router } from "./router.ts";
import "virtual:uno.css";

export default function App() {
    return (
        <Router>
            {(props) => (
                <main class="app-page">
                    <nav class="mb-lg" aria-label="ナビゲーション">
                        <a href={paths()}>講義一覧</a>
                    </nav>
                    <Loading on={props.location.pathname} fallback={<p role="status">ページを読み込み中…</p>}>
                        {props.children}
                    </Loading>
                </main>
            )}
        </Router>
    );
}
