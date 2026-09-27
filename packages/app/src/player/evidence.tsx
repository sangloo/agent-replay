import {
  concernsOf,
  type Check,
  type CheckKind,
  type Ledger,
  type Replay,
} from "@agent-replay/core";
import { CircleAlert, CircleCheck, CircleX, FlaskConical } from "lucide-react";
import * as React from "react";

import { cn } from "@/ui";

import { fileName, when } from "../labels";

const KIND: Record<CheckKind, string> = {
  test: "Tests",
  typecheck: "Type check",
  lint: "Lint",
  format: "Format",
  build: "Build",
};

/**
 * The evidence, as a reviewer asks for it: did the checks run, did they
 * pass, and did anything change after them? Every line jumps to its step.
 */
export const EvidencePanel = React.memo(function EvidencePanel({
  ledger,
  replay,
  cursor,
  onJump,
}: {
  ledger: Ledger;
  replay: Replay;
  cursor: number;
  onJump: (cursor: number) => void;
}) {
  const warnings = concernsOf(ledger).map((concern) => {
    switch (concern.kind) {
      case "no-checks":
        return (
          <Warning key="none" tone="warning" title="No checks ran">
            The agent never ran tests, a type check, lint or a build in this session.
          </Warning>
        );
      case "unresolved":
        return (
          <Warning
            key="unresolved"
            tone="danger"
            title="Failed, and never passed after"
          >
            <List>
              {ledger.unresolved.map((check) => (
                <Item key={check.index} onClick={() => onJump(check.index + 1)}>
                  <span className="font-mono">$ {check.command}</span>
                  {check.masked ? (
                    <span className="text-danger-ink">
                      {" "}
                      · exit status hidden by a pipe
                    </span>
                  ) : null}
                  {check.summary ? (
                    <span className="text-text-low"> · {check.summary}</span>
                  ) : null}
                </Item>
              ))}
            </List>
          </Warning>
        );
      case "weakened":
        return (
          <Warning
            key="weakened"
            tone="warning"
            title="Tests that lost assertions or were skipped"
          >
            <List>
              {ledger.testEdits.map((edit) => (
                <Item key={edit.index} onClick={() => onJump(edit.index + 1)}>
                  <span className="text-text-high">{fileName(edit.path)}</span>
                  <span className="text-text-low"> · {edit.concerns.join(", ")}</span>
                </Item>
              ))}
            </List>
          </Warning>
        );
      case "unbacked":
        return (
          <Warning key="unbacked" tone="warning" title="Claims no check backs">
            <List>
              {ledger.claims
                .filter((claim) => claim.backedBy === undefined)
                .map((claim) => (
                  <Item
                    key={`${claim.index}${claim.kind}`}
                    onClick={() => onJump(claim.index + 1)}
                  >
                    &ldquo;{claim.text}&rdquo;
                    <span className="text-text-low">
                      {" "}
                      · no passing {KIND[claim.kind].toLowerCase()} run after the last
                      change
                    </span>
                  </Item>
                ))}
            </List>
          </Warning>
        );
      case "stale":
        return (
          <Warning
            key="stale"
            tone="warning"
            title="Changed after the last passing check"
          >
            {ledger.unverified.slice(0, 8).map(fileName).join(", ")}
            {ledger.unverified.length > 8
              ? ` and ${ledger.unverified.length - 8} more`
              : ""}
          </Warning>
        );
    }
  });

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <section className="flex flex-col gap-2">
        <h2 className="text-2xs font-medium tracking-wide text-text-low uppercase">
          Last run of each
        </h2>
        {ledger.latest.length === 0 ? (
          <p className="text-sm text-text-low">Nothing was checked.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {ledger.latest.map(({ kind, check, changedAfter }) => (
              <li key={kind}>
                <button
                  type="button"
                  onClick={() => onJump(check.index + 1)}
                  className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left focus-bar hover:bg-hover"
                >
                  <Status check={check} />
                  <span className="w-20 shrink-0 text-sm text-text-high">
                    {KIND[kind]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-text-low">
                    {check.summary ?? (check.passed ? "passed" : "failed")}
                    {changedAfter.length ? (
                      <span className="text-warning-ink">
                        {" "}
                        · {changedAfter.length} file
                        {changedAfter.length === 1 ? "" : "s"} changed since
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {warnings.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xs font-medium tracking-wide text-text-low uppercase">
            Worth a look
          </h2>
          <div className="flex flex-col gap-2">{warnings}</div>
        </section>
      ) : ledger.checks.length ? (
        <p className="flex items-center gap-2 text-sm text-success-ink">
          <CircleCheck aria-hidden className="size-4" />
          Every check passed after the last change.
        </p>
      ) : null}

      {ledger.checks.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xs font-medium tracking-wide text-text-low uppercase">
            Every run · {ledger.checks.length}
          </h2>
          <ol className="flex flex-col">
            {ledger.checks.map((check) => (
              <li key={check.index}>
                <button
                  type="button"
                  onClick={() => onJump(check.index + 1)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-control px-2 py-1 text-left focus-bar hover:bg-hover",
                    check.index + 1 === cursor && "bg-active",
                    check.index >= cursor && "opacity-60",
                  )}
                >
                  <Status check={check} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-mid">
                    {check.command}
                  </span>
                  <span className="shrink-0 font-mono text-2xs text-text-low">
                    {when(replay.steps[check.index]!.at, replay)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
});

function Status({ check }: { check: Check }) {
  return check.passed ? (
    <CircleCheck aria-label="passed" className="size-4 shrink-0 text-success-ink" />
  ) : (
    <CircleX
      aria-label={check.masked ? "failed (exit status hidden)" : "failed"}
      className="size-4 shrink-0 text-danger-ink"
    />
  );
}

function Warning({
  tone,
  title,
  children,
}: {
  tone: "warning" | "danger";
  title: string;
  children: React.ReactNode;
}) {
  const Icon = tone === "danger" ? CircleAlert : FlaskConical;
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-control border-l-2 bg-surface-base px-3 py-2",
        tone === "danger" ? "border-danger-line" : "border-warning-line",
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            tone === "danger" ? "text-danger-ink" : "text-warning-ink",
          )}
        />
        <span className="text-sm font-medium text-text-high">{title}</span>
      </span>
      <div className="pl-5 text-xs leading-5 text-text-mid">{children}</div>
    </div>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="-ml-1.5 flex flex-col">{children}</ul>;
}

function Item({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="line-clamp-2 w-full rounded-control px-1.5 py-0.5 text-left focus-bar hover:bg-hover"
      >
        {children}
      </button>
    </li>
  );
}
