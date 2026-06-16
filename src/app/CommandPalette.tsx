interface CommandPaletteProps {
  onOpenSettings: () => void;
}

export function CommandPalette({ onOpenSettings }: CommandPaletteProps) {
  return (
    <section className="command-palette" aria-label="命令面板">
      <span className="command-palette__title">DevHub</span>
      <button type="button" onClick={onOpenSettings}>
        打开设置
      </button>
    </section>
  );
}
