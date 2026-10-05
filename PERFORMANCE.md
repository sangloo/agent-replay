# Player performance

The learning route reads configured and explicitly added repositories. It no
longer discovers courses by scanning every agent log on the machine. Add a
repository through the project picker or start with `--repo` to expose its course.
Course availability means the referenced file exists; replay parsing errors are
reported when opening that file rather than preventing the entire map from loading.

- Course maps read directory entries, not the body of every replay.
- Lesson lists initially render 24 matches, then reveal another 24 near the end
  of the list. A keyboard-accessible button works without IntersectionObserver.
  Search covers all lessons, including those not mounted yet.
- Course updates poll a file fingerprint, sequentially and only in visible tabs.
  Full content is fetched only after a change; a failed refresh is retried.
- Preparing a replay applies each step once; a change's hunks and counts, the
  net totals and course coverage are computed when first read (totals and
  coverage just after first paint). Very long histories (over 4,000 steps or
  8 MB of content) are prepared in yielding slices behind the player's
  skeleton; navigating away cancels preparation.
- Myers keeps only the diagonals each round reaches (D² rather than
  D × (N + M) trace memory) and compares interned line numbers.
- Animation progress is a subscription read only by the code pane and its
  progress bar; the rest of the player renders once per step.
- Code rows are windowed to the viewport with 12 rows of overscan on either side.
  The typing/focus anchor uses virtual coordinates; unmounted lines are not lost.
- Closed reference and advanced sections do not render their bodies. Closing a
  section releases that subtree.

## Local evidence (2026-10-05)

On the repository-owned backend corpus (233 lessons, 21 chapters), separate first
calls to the old and new map reader took approximately 70 ms and 1.6 ms. The new
HTTP map response was 2.7 ms. Preparing the longest lesson (181 steps, 839 KB JSON)
took approximately 15 ms before and 4 ms after. These are single-run measurements
with warm filesystem caches, not statistical benchmarks or end-to-end browser
latency guarantees.

Regression checks cover bounded DOM for 20,000 source lines, distant scrolling,
async/sync reconstruction parity, cancelled preparation, progressive lesson
lists and search, deferred section mounting, map isolation from corrupt replay
bodies, and cheap update fingerprints. Run `pnpm verify` for the full gate.

## Measured on a generated 3,192-step session (64 MB log)

Opening the live session until the player is interactive went from 4.4 s to
0.7 s in Chromium; `play()` from 735 ms to 28 ms; stepping back one step from
about 100 ms to about 50 ms. Playback holds 60 frames a second.

## Remaining boundaries

Saved replay JSON still transfers and parses as one document. Preparation yields
between steps, not inside an individual large edit or net diff. A bounded server metadata index for the saved-session library and chunked saved-replay loading remain follow-up work. Live-session streaming and step-list virtualization are implemented in the second pass below. Windowed source text supports reading and navigation;
browser Find and selection only cover mounted rows. Exported replay data remains
complete.

## Large live sessions (second pass)

The target session `01a06e8d-4e57-74f3-9fd7-1d859c218d75` had a 1.14 GB
Codex log and produced 13,100 replay steps, 12,211 file entries and about 59 MB
of JSON. The previous endpoint delivered its first byte after 10.8 seconds.

Live sessions now use `/api/sessions/:id/stream`. A separate Node worker captures
the session, reports its current phase, and sends bounded NDJSON batches. Source
files and steps are reconstructed incrementally in the browser, with progress and
a text preview; playback starts after completeness is checked. Backpressure stops
the worker sending more batches until the HTTP response drains. Navigating away
terminates the capture. Two concurrent captures and a three-minute timeout bound
resource use. The packaged CLI includes a separate `capture-worker.mjs` bundle.

The measured first response was about 5 ms; complete capture and transfer still
took 11.6 seconds. A course-map request remained responsive at about 6 ms during
capture. These measure responsiveness, not an 11-second-to-5-millisecond reduction
in total capture time. JSONL reading now keeps bounded line buffers rather than
the entire gigabyte log and its decoded strings. Unknown tool outputs are no longer
retained by the Codex adapter. Compressed logs still use the existing decompressor.

The step list shows one turn open and the others as one-line summaries,
windowing a very long turn. A history over 300 visible steps with more than
200 turns, or with no prompts to group by, uses a virtual tree instead; there
the selected step's detail stays in a bounded panel, and keyboard navigation
reaches unmounted steps. Folder-status aggregation now appends to owned arrays instead
of repeatedly copying growing arrays for every ancestor. The file tree was
already virtualized; its expensive preprocessing was the issue addressed here.

The target log's `exec` orchestrator calls remain unsupported by the parser.
A visible warning now distinguishes missing tool-level edits from repository
reconciliation. No external-change steps or source files are silently discarded.
Saved JSON replay loading and full CLI/save/export capture retain their existing
interfaces; the new streaming path is used by the live-session player.

Git ignore checks now remove tracked paths in bulk before checking candidates. On the target snapshot this reduced the ignore phase from 2.2 seconds to 0.13 seconds, without changing tracked-file or ignored-file semantics. Base snapshot lookup resolves the Git tree once and batches blob reads; merge attribution skips redundant work when no files arrived through merges.

Capture now checks working-file sizes before reading. Files above a conservative 2 MiB byte cap (already beyond the replay body limit) use the existing omitted-body marker. Reads are bounded even when a file grows concurrently. The target included 16.7 GB and 2.34 GB generated files. A follow-up capture measured about 7.0 seconds and 662,224 KiB peak RSS, compared with 1,286,640 KiB before this guard in the same streaming implementation. This remains a substantial capture, but no longer tries to read those enormous files into memory.
