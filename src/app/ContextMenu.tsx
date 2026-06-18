import { useEffect } from "react";

export type ContextMenuItem =
  | {
      type?: "action";
      label: string;
      onSelect: () => void;
    }
  | {
      type: "separator";
    }
  | {
      type: "label";
      label: string;
    };

export interface ContextMenuActionItem {
  label: string;
  onSelect: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  menu: ContextMenuState | null;
  onClose: () => void;
}

export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  useEffect(() => {
    if (!menu) return;

    function handlePointerDown() {
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      className="context-menu"
      role="menu"
      style={{
        left: menu.x,
        top: menu.y,
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {menu.items.map((item, index) => {
        if (item.type === "separator") {
          return <div key={`separator-${index}`} className="context-menu__separator" role="separator" />;
        }
        if (item.type === "label") {
          return (
            <div key={`label-${index}-${item.label}`} className="context-menu__label">
              {item.label}
            </div>
          );
        }
        return (
          <button
            key={`action-${index}-${item.label}`}
            type="button"
            role="menuitem"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
