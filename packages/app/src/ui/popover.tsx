import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "./cn";
import { attachedPanel } from "./panel";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(attachedPanel, "outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
