"use client";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/lib/types";

function Button({ children, variant = "primary", icon, onClick, type = "button", disabled = false, title, className = "" }: { children: React.ReactNode; variant?: "primary" | "secondary" | "ghost" | "dark"; icon?: IconName; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean; title?: string; className?: string }) {
  return <button type={type} className={`btn btn-${variant}${className ? ` ${className}` : ""}`} onClick={onClick} disabled={disabled} title={title}>{children}{icon && <Icon name={icon} size={17}/>}</button>;
}

export { Button };
