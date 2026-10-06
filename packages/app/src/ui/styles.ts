/**
 * The kit's looks as class strings, for when the element is not the kit's
 * own — a link that is a button, a tab that is a link, a row in a menu.
 * One source, so a button reads the same however it is built.
 */
import { cn } from "./cn";

const BUTTON_VARIANT = {
  primary: "bg-accent text-accent-text hover:bg-accent-hover",
  secondary: "bg-hover text-text-high hover:bg-active",
  ghost: "text-text-mid hover:bg-hover hover:text-text-high",
  emphasis: "bg-emphasis text-accent-text hover:opacity-90",
} as const;

/** Heights: 24 tiny, 28 in a toolbar, 32 by default, 36 for a page's main action. */
const BUTTON_SIZE = {
  xs: "h-6 gap-1 px-2 text-xs [&_svg]:size-3.5",
  sm: "h-7 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5",
  md: "h-8 gap-2 px-3 text-sm [&_svg]:size-4",
  lg: "h-9 gap-2 px-4 text-sm [&_svg]:size-4",
} as const;

const ICON_SIZE = {
  xs: "size-6 [&_svg]:size-3.5",
  sm: "size-7 [&_svg]:size-4",
  md: "size-8 [&_svg]:size-4",
  lg: "size-9 [&_svg]:size-4",
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANT;
export type ButtonSize = keyof typeof BUTTON_SIZE;

/** A press settles back: colours ease, and the control gives a little. */
const PRESS =
  "transition-[background-color,color,opacity,scale] duration-fast ease-out active:scale-[0.97]";

export function buttonClass({
  variant = "primary",
  size = "md",
  icon = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square, for an icon alone. */
  icon?: boolean;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control font-medium whitespace-nowrap focus-bar select-none disabled:cursor-default disabled:opacity-40 disabled:active:scale-100 [&_svg]:shrink-0",
    PRESS,
    BUTTON_VARIANT[variant],
    icon ? cn("px-0", ICON_SIZE[size]) : BUTTON_SIZE[size],
    className,
  );
}

/**
 * One option of a few — a tab, a view, a filter. The chosen one is filled;
 * the others are quiet until hovered.
 */
export function segmentClass(active: boolean, size: "sm" | "md" = "sm"): string {
  return cn(
    "flex shrink-0 items-center gap-1.5 rounded-control whitespace-nowrap focus-bar transition-colors duration-fast",
    size === "sm" ? "h-7 px-2.5 text-xs" : "h-7 px-3 text-sm",
    active
      ? "bg-active font-medium text-text-high"
      : "text-text-low hover:bg-hover hover:text-text-mid",
  );
}

/** A floating panel that hangs off a control, and grows out of it. */
export const attachedPanel =
  "z-overlay rounded-panel bg-surface-raised p-1 text-text-high shadow-popover data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in";

/** A row in a menu or a list of choices: 32px, the same everywhere. */
export const attachedItem =
  "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-left text-xs text-text-mid outline-none transition-colors duration-fast select-none hover:bg-hover hover:text-text-high focus-visible:bg-hover data-[highlighted]:bg-hover data-[highlighted]:text-text-high [&_svg]:size-3.5 [&_svg]:shrink-0";
