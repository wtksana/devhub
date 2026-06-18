import { useEffect } from "react";
import { useI18n } from "../i18n/useI18n";

export type ContextMenuItem =
  | {
      type?: "action";
      label: string;
      onSelect: () => void;
    }
  | {
      type: "submenu";
      label: string;
      items: ContextMenuItem[];
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
  const { t } = useI18n();

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
        if (item.type === "submenu") {
          return (
            <div key={`submenu-${index}-${item.label}`} className="context-menu__submenu" data-hover-bridge="true">
              <button type="button" role="menuitem" aria-haspopup="menu">
                {item.label}
              </button>
              <div
                className="context-menu context-menu__submenu-panel"
                role="menu"
                aria-label={t("context.submenu", { label: item.label })}
                data-visible-on-hover="true"
              >
                {item.items.map((child, childIndex) => {
                  if (child.type === "separator") {
                    return <div key={`separator-${childIndex}`} className="context-menu__separator" role="separator" />;
                  }
                  if (child.type === "label") {
                    return (
                      <div key={`label-${childIndex}-${child.label}`} className="context-menu__label">
                        {child.label}
                      </div>
                    );
                  }
                  if (child.type === "submenu") return null;
                  return (
                    <button
                      key={`action-${childIndex}-${child.label}`}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        child.onSelect();
                        onClose();
                      }}
                    >
                      {child.label}
                    </button>
                  );
                })}
              </div>
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
