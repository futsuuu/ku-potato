import { createMemo, For } from "solid-js";
import { splitJapaneseText } from "../budoux";

export default function BudouxText(props: { text: string }) {
  const parts = createMemo(() => splitJapaneseText(props.text));
  return (
    <span class="budoux-text">
      <For each={parts()}>
        {(part, index) => (
          <>
            {index() > 0 && <wbr />}
            {part}
          </>
        )}
      </For>
    </span>
  );
}
