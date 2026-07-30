/**
 * shadcn/ui-style primitives: unstyled-by-default components we own outright,
 * composed with Tailwind and cva. Kept dependency-light (no Radix) since none
 * of these needs a focus trap or portal yet.
 */
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] " +
    "disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-accent)] text-black hover:opacity-90",
        secondary: "bg-[var(--color-surface-2)] text-[var(--color-fg)] hover:bg-[var(--color-border)]",
        outline:
          "border border-[var(--color-border)] bg-transparent hover:bg-[var(--color-surface-2)]",
        ghost: "hover:bg-[var(--color-surface-2)]",
        ok: "bg-[var(--color-ok)] text-black hover:opacity-90",
        danger: "bg-[var(--color-danger)] text-black hover:opacity-90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded px-3 text-xs",
        lg: "h-10 px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-4 pb-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-[var(--color-muted)]", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-2", className)} {...props} />;
}

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--color-surface-2)] text-[var(--color-fg)]",
        ok: "border-transparent bg-[var(--color-ok)]/15 text-[var(--color-ok)]",
        warn: "border-transparent bg-[var(--color-warn)]/15 text-[var(--color-warn)]",
        danger: "border-transparent bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
        accent: "border-transparent bg-[var(--color-accent)]/15 text-[var(--color-accent)]",
        outline: "border-[var(--color-border)] text-[var(--color-muted)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1 text-sm",
        "placeholder:text-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-[var(--color-accent)] disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm",
        "placeholder:text-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-[var(--color-accent)] disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent",
        className
      )}
      role="status"
      aria-label="loading"
    />
  );
}

export function EmptyState({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon !== undefined && <div className="text-[var(--color-muted)]">{icon}</div>}
      <p className="text-sm text-[var(--color-fg)]">{title}</p>
      {hint !== undefined && <p className="max-w-sm text-xs text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/** Maps backend status strings to badge colours consistently across views. */
export function statusVariant(status: string): BadgeProps["variant"] {
  switch (status) {
    case "completed":
    case "approved":
    case "resolved":
      return "ok";
    case "running":
    case "in_review":
    case "revising":
    case "planning":
      return "accent";
    case "pending":
    case "blocked":
    case "escalated":
      return "warn";
    case "failed":
    case "rejected":
      return "danger";
    default:
      return "outline";
  }
}
