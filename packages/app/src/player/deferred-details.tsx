import * as React from "react";

/** Closed reference material should cost neither syntax highlighting nor DOM nodes. */
export function DeferredDetails({
  summary,
  children,
  className,
  summaryClassName,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  summaryClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <details
      className={className}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary className={summaryClassName}>{summary}</summary>
      {open ? children : null}
    </details>
  );
}
