import * as React from "react";

import { cn } from "./cn";

const SIZE = {
  xs: "h-7 px-2 text-xs",
  sm: "h-8 px-2.5 text-sm",
  md: "h-9 px-3 text-sm",
} as const;

export interface InputProps extends Omit<React.ComponentProps<"input">, "size"> {
  size?: keyof typeof SIZE;
}

export function Input({ size = "sm", className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "w-full min-w-0 rounded-control border border-line-high bg-surface-raised text-text-high outline-none placeholder:text-text-low hover:border-line-control focus-visible:border-emphasis focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden",
        SIZE[size],
        className,
      )}
      {...props}
    />
  );
}
