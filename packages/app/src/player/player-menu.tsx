import { Ellipsis, Keyboard } from "lucide-react";
import * as React from "react";

import {
  attachedItem,
  cn,
  IconButton,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui";

import { AppearanceControls } from "../appearance";

/**
 * What the header needs now and then rather than all the time — the
 * shortcuts, the appearance — behind one button, so the header keeps to the
 * replay and the two things done with it.
 */
export function PlayerMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const [open, setOpen] = React.useState(false);
  const item = cn(
    attachedItem,
    "flex h-8 w-full items-center gap-2.5 px-2.5 text-left text-xs text-text-mid focus-bar hover:bg-hover hover:text-text-high [&_svg]:size-3.5 [&_svg]:shrink-0",
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton label="More" variant="ghost" size="sm">
          <Ellipsis />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60">
        <button
          type="button"
          className={item}
          onClick={() => {
            setOpen(false);
            onShortcuts();
          }}
        >
          <Keyboard aria-hidden />
          Keyboard shortcuts
          <span className="ml-auto">
            <Kbd>?</Kbd>
          </span>
        </button>
        <div className="my-1 h-px bg-line" />
        <AppearanceControls />
      </PopoverContent>
    </Popover>
  );
}
