import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { callBackend, listenBackend } from "../../lib/tauri";

interface TerminalTabProps {
  connectionId: string;
}

interface TerminalSessionResponse {
  session_id: string;
}

interface TerminalOutputEvent {
  session_id: string;
  data: string;
}

export function TerminalTab({ connectionId }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let disposeInput: { dispose: () => void } | null = null;
    let unlistenOutput: (() => void) | null = null;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Consolas, monospace",
      fontSize: 14,
      convertEol: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminal.writeln(`Connecting to ${connectionId}...`);

    disposeInput = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      void callBackend<void>("write_terminal", {
        request: { session_id: sessionId, data },
      });
    });

    void listenBackend<TerminalOutputEvent>("terminal://output", (event) => {
      if (event.session_id === sessionIdRef.current) {
        terminal.write(event.data);
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenOutput = unlisten;
    });

    void callBackend<TerminalSessionResponse>("open_terminal", {
      request: {
        connection_id: connectionId,
        cols: terminal.cols || 80,
        rows: terminal.rows || 24,
      },
    })
      .then((response) => {
        sessionIdRef.current = response.session_id;
        if (disposed) {
          void callBackend<void>("close_terminal", { sessionId: response.session_id });
          return;
        }
        terminal.writeln("Connected.");
        void callBackend<void>("resize_terminal", {
          request: {
            session_id: response.session_id,
            cols: terminal.cols || 80,
            rows: terminal.rows || 24,
          },
        });
      })
      .catch((caught: unknown) => {
        terminal.writeln(`[devhub] ${caught instanceof Error ? caught.message : String(caught)}`);
      });

    return () => {
      disposed = true;
      disposeInput?.dispose();
      unlistenOutput?.();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) {
        void callBackend<void>("close_terminal", { sessionId });
      }
      terminal.dispose();
    };
  }, [connectionId]);

  return <div className="terminal-tab" aria-label="SSH 终端" ref={containerRef} />;
}
