import type { FunctionComponent, SVGProps } from "react";

interface AppIconProps {
  icon: FunctionComponent<SVGProps<SVGSVGElement>>;
  label?: string;
  decorative?: boolean;
  className?: string;
}

export function AppIcon({ icon: Icon, label, decorative = false, className }: AppIconProps) {
  const classNames = ["app-icon", className].filter(Boolean).join(" ");
  return (
    <Icon
      className={classNames}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : label}
    />
  );
}
