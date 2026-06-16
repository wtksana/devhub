import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalTabProps {
  connectionId: string;
}

export function TerminalTab({ connectionId }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

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

    return () => {
      terminal.dispose();
    };
  }, [connectionId]);

  return <div className="terminal-tab" aria-label="SSH 终端" ref={containerRef} />;
}
