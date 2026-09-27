import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "./cn";
import { attachedPanel } from "./panel";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

const SIZE = {
  xs: "h-6 px-2 text-xs",
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
} as const;

export function SelectTrigger({
  className,
  size = "md",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: keyof typeof SIZE;
}) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "inline-flex cursor-pointer items-center justify-between gap-1.5 rounded-control border border-line-high bg-surface-raised text-text-high focus-bar hover:border-line-control data-[placeholder]:text-text-low [&>span]:truncate",
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
          "max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden",
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
        "relative flex h-7 cursor-pointer items-center rounded-control pr-7 pl-2 text-xs outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2">
        <Check aria-hidden className="size-3.5" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
