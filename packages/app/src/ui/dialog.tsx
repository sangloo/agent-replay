import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { IconButton } from "./button";
import { cn } from "./cn";

export const Dialog = DialogPrimitive.Root;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-overlay animate-fade-in bg-black/40 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-overlay flex max-h-[85dvh] w-[calc(100vw-2rem)] max-w-lg -translate-1/2 animate-dialog-in flex-col gap-4 rounded-surface bg-surface-raised p-6 text-text-high shadow-modal outline-none",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <IconButton label="Close" size="sm" className="absolute top-3 right-3">
            <X />
          </IconButton>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 pr-6", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex items-center justify-end gap-2", className)} {...props} />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-base font-medium", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-text-mid", className)}
      {...props}
    />
  );
}
