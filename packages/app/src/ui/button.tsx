import { LoaderCircle } from "lucide-react";
import * as React from "react";

import { cn } from "./cn";

const VARIANT = {
  primary: "bg-accent text-accent-text hover:bg-accent-hover",
  secondary:
    "border border-line-control bg-surface-raised text-text-high hover:bg-hover",
  ghost: "text-text-mid hover:bg-hover hover:text-text-high",
  emphasis: "bg-emphasis text-accent-text hover:opacity-90",
} as const;

const SIZE = {
  xs: "h-6 gap-1 px-2 text-xs [&_svg]:size-3.5",
  sm: "h-7 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5",
  md: "h-8 gap-2 px-3 text-sm [&_svg]:size-4",
} as const;

const ICON_SIZE = {
  xs: "size-6 [&_svg]:size-3.5",
  sm: "size-7 [&_svg]:size-4",
  md: "size-8 [&_svg]:size-4",
} as const;

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  /** Busy: a spinner in place of the label's icon, and not pressable. */
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control font-medium whitespace-nowrap focus-bar select-none disabled:cursor-default disabled:opacity-40 [&_svg]:shrink-0",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "aria-label"> {
  /** The accessible name, and the tooltip. Required: an icon has no text. */
  label: string;
}

export function IconButton({
  label,
  variant = "ghost",
  size = "sm",
  className,
  title,
  ...props
}: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      title={title ?? label}
      variant={variant}
      className={cn("px-0", ICON_SIZE[size], className)}
      {...props}
    />
  );
}
