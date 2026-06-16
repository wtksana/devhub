import { useState } from "react";
import { useAiChat } from "./useAiChat";

export function AiPanel() {
  const [prompt, setPrompt] = useState("");
  const { answer, error, ask } = useAiChat();

  return (
    <aside className="ai-panel" aria-label="AI 对话">
      <h2>AI</h2>
      <p>AI 使用 BYOK。生成命令和脚本，但不会自动执行。</p>
      <textarea
        aria-label="AI 输入"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <button type="button" onClick={() => void ask(prompt)}>
        发送
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {answer ? <pre>{answer}</pre> : null}
    </aside>
  );
}
