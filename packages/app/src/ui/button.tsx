import { LoaderCircle } from "lucide-react";
import * as React from "react";

import { buttonClass, type ButtonSize, type ButtonVariant } from "./styles";

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
      className={buttonClass({ variant, size, className })}
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
  disabled,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      className={buttonClass({ variant, size, icon: true, className })}
      {...props}
    />
  );
}
