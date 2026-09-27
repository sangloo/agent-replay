import { cn } from "@/ui";
import * as React from "react";

export interface ChoiceOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** A longer name, for the tooltip. */
  hint?: string;
}

/**
 * A few mutually exclusive options as quiet buttons — the view, which files,
 * which list. Deliberately still: the chosen one simply is, with no
 * indicator travelling between them.
 */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex items-center gap-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          title={option.hint}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-control px-2.5 text-xs whitespace-nowrap focus-bar",
            value === option.value
              ? "bg-active font-medium text-text-high"
              : "text-text-low hover:bg-hover hover:text-text-mid",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
