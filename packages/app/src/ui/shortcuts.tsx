import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog";

export interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string; description: string }[];
}

const KEY_NAME: Record<string, string> = {
  space: "Space",
  arrowright: "→",
  arrowleft: "←",
  arrowup: "↑",
  arrowdown: "↓",
  home: "Home",
  end: "End",
  escape: "Esc",
  enter: "Enter",
  shift: "Shift",
};

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line-high bg-surface-low px-1.5 font-sans text-2xs font-medium text-text-mid">
      {children}
    </kbd>
  );
}

export function ShortcutsSheet({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly ShortcutGroup[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Everything the player does, from the keys.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 flex flex-col gap-5 overflow-auto px-1">
          {groups.map((group) => (
            <section key={group.title} className="flex flex-col gap-1.5">
              <h3 className="text-2xs font-medium tracking-wide text-text-low uppercase">
                {group.title}
              </h3>
              <dl className="flex flex-col">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between gap-4 py-1 text-sm"
                  >
                    <dt className="text-text-mid">{shortcut.description}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {shortcut.keys.split("+").map((key) => (
                        <Kbd key={key}>{KEY_NAME[key] ?? key.toUpperCase()}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
