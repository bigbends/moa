import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "accent";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "m" | "l";
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "m", icon, className, children, ...rest }, ref) {
  return (
    <button ref={ref} className={cx("btn", `btn-${variant}`, `btn-${size}`, !children && "btn-icon-only", className)} {...rest}>
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
});

export function ButtonLink({ to, variant = "secondary", size = "m", icon, children, className }: { to: string; variant?: Variant; size?: "m" | "l"; icon?: ReactNode; children: ReactNode; className?: string }) {
  return <Link to={to} className={cx("btn", `btn-${variant}`, `btn-${size}`, className)}>{icon}<span>{children}</span></Link>;
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button aria-label={label} title={label} className={cx("icon-btn", className)} {...rest}>{children}</button>;
}

export function ProgressBar({ ratio, className }: { ratio: number; className?: string }) {
  return <span className={cx("progress", className)} aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }} /></span>;
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={cx("sk", className)} style={style} aria-hidden="true" />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 28 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="불러오는 중" />;
}
