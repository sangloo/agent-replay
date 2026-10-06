import { ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "./cn";

export interface TreeLine {
  id: string;
  parentId: string | null;
  label: string;
  /** A folder: it has rows under it and opens rather than selects. */
  container?: boolean;
}

export interface TreeRow extends TreeLine {
  depth: number;
  expanded: boolean;
}

export interface TreeProps {
  /** Every line, parents before their children, siblings in order. */
  lines: readonly TreeLine[];
  /** Open folders — or every folder, while a filter is on. */
  expanded: ReadonlySet<string> | "all";
  onToggle: (id: string) => void;
  selected?: string;
  onSelect: (id: string) => void;
  /** Scroll this row into view whenever the token changes. */
  reveal?: { id: string; token: number };
  /** Marked inside each label. */
  highlight?: string;
  label: string;
  rowHeight?: number;
  indent?: number;
  icon?: (row: TreeRow) => React.ReactNode;
  /** Trailing content: badges, counts. */
  actions?: (row: TreeRow) => React.ReactNode;
  labelClassName?: (row: TreeRow) => string | undefined;
  className?: string;
}

const OVERSCAN = 12;

function Label({ text, highlight }: { text: string; highlight?: string }) {
  if (!highlight) return <>{text}</>;
  const at = text.toLowerCase().indexOf(highlight.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-warning-subtle text-inherit">
        {text.slice(at, at + highlight.length)}
      </mark>
      {text.slice(at + highlight.length)}
    </>
  );
}

/**
 * A file explorer's tree: only the rows in view are rendered, so a whole
 * repository scrolls as lightly as a handful of changes. Keyboard as in an
 * editor — arrows move, → opens, ← closes or climbs, Enter picks.
 */
export function Tree({
  lines,
  expanded,
  onToggle,
  selected,
  onSelect,
  reveal,
  highlight,
  label,
  rowHeight = 28,
  indent = 12,
  icon,
  actions,
  labelClassName,
  className,
}: TreeProps) {
  const rows = React.useMemo(() => {
    const out: TreeRow[] = [];
    const depth = new Map<string | null, number>([[null, -1]]);
    const shown = new Set<string | null>([null]);
    for (const line of lines) {
      if (!shown.has(line.parentId)) continue;
      const parent = line.parentId === null ? null : line.parentId;
      const isOpen = expanded === "all" || expanded.has(line.id);
      const row: TreeRow = {
        ...line,
        depth: (depth.get(parent) ?? -1) + 1,
        expanded: Boolean(line.container) && isOpen,
      };
      out.push(row);
      depth.set(line.id, row.depth);
      if (row.container && isOpen) shown.add(line.id);
    }
    return out;
  }, [lines, expanded]);

  const scroller = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ top: 0, height: 600 });
  React.useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const measure = () => setView({ top: box.scrollTop, height: box.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const [cursor, setCursor] = React.useState<string>();
  const index = rows.findIndex((row) => row.id === (cursor ?? selected));

  // Bring a row into view: the file on screen, or the keyboard's row.
  const scrollTo = React.useCallback(
    (at: number) => {
      const box = scroller.current;
      if (!box || at < 0) return;
      const top = at * rowHeight;
      if (top < box.scrollTop) box.scrollTop = top;
      else if (top + rowHeight > box.scrollTop + box.clientHeight)
        box.scrollTop = top + rowHeight - box.clientHeight;
    },
    [rowHeight],
  );
  const revealId = reveal?.id;
  const revealToken = reveal?.token;
  React.useLayoutEffect(() => {
    if (revealId === undefined) return;
    const at = rows.findIndex((row) => row.id === revealId);
    const box = scroller.current;
    if (!box || at < 0) return;
    const top = at * rowHeight;
    // Centred when it was out of sight; left alone when it already shows.
    if (top < box.scrollTop || top + rowHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    // Rows is a dependency so a reveal waits for the folders to open.
  }, [revealId, revealToken, rows, rowHeight]);

  const start = Math.max(0, Math.floor(view.top / rowHeight) - OVERSCAN);
  const end = Math.min(
    rows.length,
    Math.ceil((view.top + view.height) / rowHeight) + OVERSCAN,
  );

  const move = (to: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, to))];
    if (!row) return;
    setCursor(row.id);
    scrollTo(rows.indexOf(row));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const row = rows[index];
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(rows.length - 1);
        break;
      case "ArrowRight":
        if (!row?.container) return;
        if (!row.expanded) onToggle(row.id);
        else move(index + 1);
        break;
      case "ArrowLeft":
        if (!row) return;
        if (row.container && row.expanded) onToggle(row.id);
        else if (row.parentId) move(rows.findIndex((r) => r.id === row.parentId));
        break;
      case "Enter":
      case " ":
        if (!row) return;
        if (row.container) onToggle(row.id);
        else onSelect(row.id);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const activeId = rows[index]?.id;
  const domId = (id: string) => `tree-${encodeURIComponent(id)}`;

  return (
    <div
      ref={scroller}
      role="tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={activeId ? domId(activeId) : undefined}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        setView((last) => ({ ...last, top }));
      }}
      onKeyDown={onKeyDown}
      className={cn("relative overflow-auto focus-bar outline-none", className)}
    >
      <div style={{ height: rows.length * rowHeight }} className="relative">
        {rows.slice(start, end).map((row, i) => {
          const at = start + i;
          const isSelected = row.id === selected;
          const isCursor = row.id === cursor;
          return (
            <div
              key={row.id}
              id={domId(row.id)}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={row.container ? row.expanded : undefined}
              aria-selected={row.container ? undefined : isSelected}
              data-tree-row={row.id}
              onClick={() => {
                setCursor(row.id);
                if (row.container) onToggle(row.id);
                else onSelect(row.id);
              }}
              className={cn(
                "absolute inset-x-1.5 flex cursor-pointer items-center gap-1.5 rounded-control pr-1 text-body transition-colors duration-fast select-none",
                isSelected ? "bg-active text-text-high" : "hover:bg-hover",
                isCursor && "outline outline-1 -outline-offset-1 outline-line-control",
              )}
              style={{
                top: at * rowHeight,
                height: rowHeight,
                paddingLeft: 6 + row.depth * indent,
              }}
            >
              <span
                aria-hidden
                className="flex size-4 shrink-0 items-center justify-center"
              >
                {row.container ? (
                  <ChevronRight
                    className={cn(
                      "size-3.5 text-text-low transition-transform duration-fast",
                      row.expanded && "rotate-90",
                    )}
                  />
                ) : null}
              </span>
              {icon ? (
                <span aria-hidden className="flex shrink-0 [&_svg]:size-4">
                  {icon(row)}
                </span>
              ) : null}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  row.container ? "text-text-mid" : "text-text-high",
                  labelClassName?.(row),
                )}
              >
                <Label text={row.label} highlight={highlight} />
              </span>
              {actions ? actions(row) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
