import { Title } from "@solidjs/meta";
import { createSignal } from "solid-js";
import type {} from "./bindings.d.ts";
import "./style.css";

export default function App() {
    const [name, setName] = createSignal("KU-POTATO");
    const [message, setMessage] = createSignal("");
    const [pending, setPending] = createSignal(false);

    const greet = () => {
        setPending(true);
        void bindings.greet(name()).then(
            (result) => setMessage(result),
            () => setMessage("Failed to call the Deno greeting handler."),
        ).finally(() => setPending(false));
    };

    return (
        <>
            <Title>KU-POTATO</Title>
            <main>
                <h1>KU-POTATO</h1>
                <p>Deno Desktop + Solid 2.0 SPA</p>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        greet();
                    }}
                >
                    <label for="name">Name</label>
                    <input id="name" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
                    <button type="submit" disabled={pending()}>{pending() ? "Calling…" : "Greet from Deno"}</button>
                </form>
                <p role="status">{message()}</p>
            </main>
        </>
    );
}
