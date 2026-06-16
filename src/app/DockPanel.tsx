import type { ReactNode } from "react";

interface DockPanelProps {
  side: "left" | "right";
  label: string;
  children: ReactNode;
}

export function DockPanel({ side, label, children }: DockPanelProps) {
  return (
    <aside className={`dock-panel dock-panel--${side}`} aria-label={label}>
      {children}
    </aside>
  );
}
