interface WorkspaceTabsProps {
  active: "terminal" | "sftp" | "settings";
  onSelect: (workspace: "terminal" | "sftp" | "settings") => void;
}

export function WorkspaceTabs({ active, onSelect }: WorkspaceTabsProps) {
  const tabs = [
    ["terminal", "终端"],
    ["sftp", "SFTP"],
    ["settings", "设置"],
  ] as const;

  return (
    <nav className="workspace-tabs" aria-label="工作区标签">
      {tabs.map(([id, label]) => (
        <button key={id} type="button" aria-pressed={active === id} onClick={() => onSelect(id)}>
          {label}
        </button>
      ))}
    </nav>
  );
}
