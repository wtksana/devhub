import { useState } from "react";
import { callBackend } from "../../lib/tauri";

interface AiChatResponse {
  text: string;
}

export function useAiChat() {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function ask(prompt: string, context?: string) {
    try {
      const response = await callBackend<AiChatResponse>("ai_chat", {
        request: { prompt, context },
      });
      setAnswer(response.text);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return { answer, error, ask };
}
