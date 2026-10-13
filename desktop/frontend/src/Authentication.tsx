import { createEffect, createSignal, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { API, Schema } from "./api";
import { createOperation } from "./operation";
import Progress from "./Progress";

type AuthenticationAPI = Pick<API, "auth" | "login" | "check"> &
  Partial<Pick<API, "register" | "webauthn" | "deleteWebAuthn">>;

export default function Authentication(props: {
  api: AuthenticationAPI;
  title: string;
  onLogin?: () => void;
  children?: JSX.Element;
}) {
  const [state, setState] = createSignal<Schema["AuthState"]>({ status: "unknown" });
  const [registered, setRegistered] = createSignal(false);
  const operation = createOperation<Schema["AuthState"]>();
  async function authenticate(kind: "login" | "check" | "register" | "deleteWebAuthn") {
    const api = untrack(() => props.api);
    const result = await operation.run(async (observe) => {
      if (kind === "register") {
        await api.register?.(observe);
        setRegistered(true);
        return api.auth();
      }
      if (kind === "deleteWebAuthn") {
        await api.deleteWebAuthn?.(observe);
        setRegistered(false);
        return api.auth();
      }
      return api[kind](observe);
    });
    if (result) {
      setState(result);
      if (kind === "login") props.onLogin?.();
    }
  }
  createEffect(
    () => props.api,
    (api) => {
      void operation
        .run(async () => {
          const [state, credential] = await Promise.all([api.auth(), api.webauthn?.()]);
          if (credential) setRegistered(credential.registered);
          return state;
        })
        .then((result) => {
          if (result) setState(result);
        });
    },
  );
  return (
    <section class="auth" aria-label={props.title}>
      <strong>{props.title}</strong>
      <span>
        {state().status === "authenticated"
          ? "ログイン済み"
          : state().status === "unauthenticated"
            ? "未ログイン"
            : "認証未確認"}
      </span>
      <button
        class="app-button"
        disabled={operation.pending()}
        onClick={() => void authenticate("login")}
      >
        <span class="i-lucide-log-in" aria-hidden="true" />
        ブラウザでログイン
      </button>
      <button
        class="quiet-button"
        disabled={operation.pending()}
        onClick={() => void authenticate("check")}
      >
        認証状態を確認
      </button>
      <Show when={props.api.register}>
        <details>
          <summary>認証の設定</summary>
          <div class="auth-settings">
            <Show when={!registered()}>
              <button
                class="quiet-button"
                disabled={operation.pending()}
                onClick={() => void authenticate("register")}
              >
                認証デバイスを登録
              </button>
            </Show>
            <Show when={registered()}>
              <button
                class="quiet-button"
                disabled={operation.pending()}
                onClick={() => void authenticate("deleteWebAuthn")}
              >
                保存済みWebAuthn情報を削除
              </button>
            </Show>
          </div>
        </details>
      </Show>
      <Progress
        pending={operation.pending()}
        error={operation.error()}
        status={operation.status()}
      />
      <Show when={state().status !== "authenticated"}>{props.children}</Show>
    </section>
  );
}
