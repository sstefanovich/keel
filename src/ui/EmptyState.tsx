import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

/**
 * What a view shows when there's nothing in it yet: an icon, a short title, how to get started,
 * and (optionally) buttons for the obvious next step. `compact` is for inside panels.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="empty-compact">
        <Icon size={16} aria-hidden="true" />
        <span>
          <b>{title}</b>
          {children ? <> {children}</> : null}
        </span>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={26} aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      {children && <div className="empty-body">{children}</div>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}
