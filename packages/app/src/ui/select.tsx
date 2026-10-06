import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "./cn";
import { attachedItem, attachedPanel } from "./styles";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

const SIZE = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
} as const;

// A field reads as one, filled; a choice in a toolbar is quiet until hovered.
const VARIANT = {
  outline: "bg-hover text-text-high hover:bg-active",
  ghost: "text-text-mid hover:bg-hover hover:text-text-high",
} as const;

export function SelectTrigger({
  className,
  size = "md",
  variant = "outline",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: keyof typeof SIZE;
  variant?: keyof typeof VARIANT;
}) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "inline-flex cursor-pointer items-center justify-between gap-1.5 rounded-control focus-bar transition-colors duration-fast data-[placeholder]:text-text-low [&>span]:truncate",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-text-low" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={6}
        className={cn(
          attachedPanel,
          "max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) origin-(--radix-select-content-transform-origin) overflow-hidden",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        attachedItem,
        "relative pr-8 data-[disabled]:opacity-40 data-[state=checked]:text-text-high",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5">
        <Check aria-hidden className="size-3.5" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
