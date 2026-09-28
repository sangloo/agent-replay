/**
 * Markdown, parsed: the subset course explanations use — headings,
 * paragraphs, lists, quotes, tables, fenced code, and `$$…$$` mathematics.
 * Forgiving by design: whatever it does not recognise is a paragraph.
 */

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "math"; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "list"; ordered: boolean; items: Block[][] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "rule" }
  | {
      kind: "callout";
      tone: "note" | "tip" | "warning" | "checkpoint";
      title: string;
      blocks: Block[];
    }
  | { kind: "details"; title: string; blocks: Block[] };

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
/** A line that starts a block of its own, ending a paragraph or list item. */
const BLOCK_START = /^(#{1,6})\s|^\s*(```|~~~)|^\s*\$\$|^\s*>/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Markdown → blocks. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const details = /^:::details[ \t]+(.+)$/.exec(line.trim());
    if (details) {
      const end = lines.findIndex((value, at) => at > i && value.trim() === ":::");
      if (end > i) {
        blocks.push({
          kind: "details",
          title: details[1]!,
          blocks: parseBlocks(lines.slice(i + 1, end).join("\n")),
        });
        i = end + 1;
        continue;
      }
    }
    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!))
        body.push(lines[i++]!);
      i++;
      blocks.push({ kind: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }
    if (line.trim().startsWith("$$")) {
      const rest = line.trim().slice(2);
      const body: string[] = [];
      if (rest.endsWith("$$") && rest.length > 2) {
        blocks.push({ kind: "math", text: rest.slice(0, -2) });
        i++;
        continue;
      }
      if (rest) body.push(rest);
      i++;
      while (i < lines.length && !lines[i]!.trim().endsWith("$$"))
        body.push(lines[i++]!);
      if (i < lines.length) body.push(lines[i]!.trim().slice(0, -2));
      i++;
      blocks.push({ kind: "math", text: body.join("\n").trim() });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        text: heading[2]!.trim(),
      });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (line.trimStart().startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith(">"))
        body.push(lines[i++]!.trimStart().replace(/^>\s?/, ""));
      const callout = /^\[!(NOTE|TIP|WARNING|CHECKPOINT)\](?:\s+(.*))?$/.exec(
        body[0] ?? "",
      );
      if (callout)
        blocks.push({
          kind: "callout",
          tone: callout[1]!.toLowerCase() as "note" | "tip" | "warning" | "checkpoint",
          title: callout[2] || callout[1]!,
          blocks: parseBlocks(body.slice(1).join("\n")),
        });
      else blocks.push({ kind: "quote", blocks: parseBlocks(body.join("\n")) });
      continue;
    }
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]!)
    ) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim())
        rows.push(cells(lines[i++]!));
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const indent = item[1]!.length;
      const ordered = /\d/.test(item[2]!);
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const next = LIST_ITEM.exec(current);
        const lead = current.search(/\S/);
        if (next && lead === indent && /\d/.test(next[2]!) === ordered) {
          items.push([next[3]!]);
        } else if (!current.trim()) {
          // A blank line continues the list only if the list goes on after it.
          const after = lines[i + 1] ?? "";
          const sibling = LIST_ITEM.exec(after);
          if (!(
            after.search(/\S/) > indent ||
            (sibling && sibling[1]!.length === indent)
          ))
            break;
          items.at(-1)!.push("");
        } else if (lead > indent) {
          // Indented: a continuation or a nested list, belonging to the item above.
          items.at(-1)!.push(current.slice(Math.min(lead, indent + 2)));
        } else if (!next && !BLOCK_START.test(current) && lines[i - 1]?.trim()) {
          items.at(-1)!.push(current.trim());
        } else break;
        i++;
      }
      blocks.push({
        kind: "list",
        ordered,
        items: items.map((body) => parseBlocks(body.join("\n"))),
      });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !BLOCK_START.test(lines[i]!) &&
      !(body.length && LIST_ITEM.test(lines[i]!))
    ) {
      body.push(lines[i++]!.trim());
    }
    blocks.push({ kind: "paragraph", text: body.join(" ") });
  }
  return blocks;
}

/** A line of plain text from Markdown: for captions and labels. */
export function plainText(markdown: string): string {
  return (
    markdown
      // Captions must not reveal a worked answer hidden inside a disclosure.
      .replace(
        /^[ \t]*:::details[ \t]+([^\r\n]+)\r?\n[\s\S]*?^[ \t]*:::[ \t]*\r?$/gm,
        "$1",
      )
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\$\$[\s\S]*?\$\$/g, " ")
      .replace(/^\s*>\s?(?:\[!(?:NOTE|TIP|WARNING|CHECKPOINT)\]\s*)?/gm, "")
      .replace(/^:::details\s*/gm, "")
      .replace(/^:::\s*$/gm, "")
      .replace(/^#+\s*/gm, "")
      // Inline maths reads as its formula, without the markup around it.
      .replace(/\$([^$\n]+)\$/g, (_math, tex: string) =>
        tex.replace(/\\([a-zA-Z]+)\s*/g, "$1 ").replace(/[{}]/g, ""),
      )
      .replace(/[*_`~]|\[([^\]]*)\]\([^)]*\)/g, (_whole, label?: string) => label ?? "")
      .replace(/\s+/g, " ")
      .trim()
  );
}
