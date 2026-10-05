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
        // Filled rather than outlined; the accent rings it while it is typed in.
        "w-full min-w-0 rounded-control bg-hover text-text-high outline-none placeholder:text-text-low hover:bg-active focus-visible:bg-transparent focus-visible:shadow-[inset_0_0_0_1.5px_var(--emphasis)] focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden",
        SIZE[size],
        className,
      )}
      {...props}
    />
  );
}
