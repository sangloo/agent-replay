import { cn, segmentClass } from "@/ui";
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
          className={segmentClass(value === option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
