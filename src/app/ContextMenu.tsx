import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";

export type ContextMenuItem =
  | {
      type?: "action";
      label: string;
      disabled?: boolean;
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

interface ViewportPosition {
  left: number;
  top: number;
}

function clampToViewport(left: number, top: number, width: number, height: number): ViewportPosition {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.max(margin, Math.min(left, maxLeft)),
    top: Math.max(margin, Math.min(top, maxTop)),
  };
}

export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  const { t } = useI18n();
  const skipNextClickRef = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(() => ({
    left: menu?.x ?? 0,
    top: menu?.y ?? 0,
  }));

  useLayoutEffect(() => {
    if (!menu) return;
    const nextMenu = menu;

    function updatePosition() {
      const element = menuRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setPosition(clampToViewport(nextMenu.x, nextMenu.y, rect.width, rect.height));
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [menu]);

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

  function runAction(item: Extract<ContextMenuItem, { label: string; onSelect: () => void }>) {
    if (item.disabled) return;
    item.onSelect();
    onClose();
  }

  function runActionFromPointerDown(item: Extract<ContextMenuItem, { label: string; onSelect: () => void }>) {
    skipNextClickRef.current = true;
    runAction(item);
  }

  function runActionFromClick(item: Extract<ContextMenuItem, { label: string; onSelect: () => void }>) {
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false;
      return;
    }
    runAction(item);
  }

  function renderMenuItems(items: ContextMenuItem[]) {
    return items.map((item, index) => {
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
          <ContextSubmenu key={`submenu-${index}-${item.label}`} item={item} renderItems={renderMenuItems} label={t("context.submenu", { label: item.label })} />
        );
      }
      return (
        <button
          key={`action-${index}-${item.label}`}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            runActionFromPointerDown(item);
          }}
          onClick={() => {
            runActionFromClick(item);
          }}
        >
          {item.label}
        </button>
      );
    });
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{
        left: position.left,
        top: position.top,
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {renderMenuItems(menu.items)}
    </div>
  );
}

interface ContextSubmenuProps {
  item: Extract<ContextMenuItem, { type: "submenu" }>;
  label: string;
  renderItems: (items: ContextMenuItem[]) => React.ReactNode;
}

function ContextSubmenu({ item, label, renderItems }: ContextSubmenuProps) {
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: -5 });

  useLayoutEffect(() => {
    function updatePosition() {
      const submenu = submenuRef.current;
      const panel = panelRef.current;
      if (!submenu || !panel) return;
      const submenuRect = submenu.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const preferredLeft = submenuRect.width + 14;
      const preferredTop = -5;
      const absolutePosition = clampToViewport(
        submenuRect.left + preferredLeft,
        submenuRect.top + preferredTop,
        panelRect.width,
        panelRect.height,
      );
      setPosition({
        left: absolutePosition.left - submenuRect.left,
        top: absolutePosition.top - submenuRect.top,
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [item.items]);

  return (
    <div ref={submenuRef} className="context-menu__submenu" data-hover-bridge="true">
      <button type="button" role="menuitem" aria-haspopup="menu">
        {item.label}
      </button>
      <div
        ref={panelRef}
        className="context-menu context-menu__submenu-panel"
        role="menu"
        aria-label={label}
        data-visible-on-hover="true"
        style={{
          left: position.left,
          top: position.top,
        }}
      >
        {renderItems(item.items)}
      </div>
    </div>
  );
}
