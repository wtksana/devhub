interface CommandPaletteProps {
  onOpenSettings: () => void;
}

export function CommandPalette({ onOpenSettings }: CommandPaletteProps) {
  return (
    <section className="command-palette" aria-label="命令面板">
      <button type="button" onClick={onOpenSettings}>
        打开 Settings
      </button>
    </section>
  );
}
