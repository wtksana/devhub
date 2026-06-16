import { useState } from "react";
import { useAiChat } from "./useAiChat";

export function AiPanel() {
  const [prompt, setPrompt] = useState("");
  const { answer, error, ask } = useAiChat();

  return (
    <aside className="ai-panel" aria-label="AI 对话">
      <header>
        <h2>AI</h2>
        <span>BYOK</span>
      </header>
      <p className="ai-panel__hint">生成命令和脚本，但不会自动执行。</p>
      <div className="ai-panel__result">
        {error ? <p role="alert">{error}</p> : null}
        {answer ? <pre>{answer}</pre> : <span>等待输入问题。</span>}
      </div>
      <div className="ai-panel__composer">
        <textarea
          aria-label="AI 输入"
          placeholder="询问当前连接、命令或 SQL..."
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <button type="button" onClick={() => void ask(prompt)}>
          发送
        </button>
      </div>
    </aside>
  );
}
