/**
 * Teaching text, rendered: the Markdown a course's explanations are written
 * in, with `$…$` and `$$…$$` for mathematics.
 *
 * It renders to React elements, never to an HTML string, so nothing in a
 * course — which an exported file carries to other people — can inject
 * markup or script. The only HTML inserted as such is KaTeX's MathML, which
 * KaTeX builds from the formula with every character escaped.
 */

import katex from "katex";
import * as React from "react";

import { cn } from "@/ui";

import { CATEGORY_CLASS, languageOf, paint, tokenize } from "./highlight";
import { parseBlocks, type Block } from "./markdown-parse";

function MathSpan({ tex, display }: { tex: string; display: boolean }) {
  const html = React.useMemo(
    () =>
      katex.renderToString(tex, {
        displayMode: display,
        output: "mathml",
        throwOnError: false,
        trust: false,
      }),
    [tex, display],
  );
  return display ? (
    <div
      className="my-3 overflow-x-auto text-center"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
}

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\$(?![\s$])((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])/g;

/** Only links that go somewhere safe: the web, or a place in this page. */
function safeHref(href: string): string | undefined {
  return /^(https?:\/\/|#|\/(?!\/)|\.\.?\/)/i.test(href) ? href : undefined;
}

function Inline({ text }: { text: string }): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    last = match.index + match[0].length;
    const [, , code, math, label, href, bold, bold2, strike, em, em2] = match;
    if (code !== undefined)
      out.push(
        <code
          key={key++}
          className="rounded-[4px] bg-surface-mid px-1 py-px font-mono text-[0.9em]"
        >
          {code.trim()}
        </code>,
      );
    else if (math !== undefined)
      out.push(<MathSpan key={key++} tex={math} display={false} />);
    else if (label !== undefined) {
      const safe = safeHref(href!);
      out.push(
        safe ? (
          <a
            key={key++}
            href={safe}
            target={safe.startsWith("#") ? undefined : "_blank"}
            rel="noreferrer"
            className="text-emphasis underline decoration-emphasis/40 underline-offset-2 hover:decoration-emphasis"
          >
            <Inline text={label} />
          </a>
        ) : (
          label
        ),
      );
    } else if (bold !== undefined || bold2 !== undefined)
      out.push(
        <strong key={key++} className="font-semibold text-text-high">
          <Inline text={(bold ?? bold2)!} />
        </strong>,
      );
    else if (strike !== undefined)
      out.push(
        <s key={key++}>
          <Inline text={strike} />
        </s>,
      );
    else if (em !== undefined || em2 !== undefined)
      out.push(
        <em key={key++}>
          <Inline text={(em ?? em2)!} />
        </em>,
      );
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function Code({ lang, text }: { lang: string; text: string }) {
  const language = lang ? (languageOf(`x.${lang}`) ?? lang) : undefined;
  const runs = React.useMemo(() => tokenize(text, language), [text, language]);
  return (
    <pre className="my-3 overflow-x-auto rounded-control border border-line bg-surface-base px-3 py-2.5 font-mono text-[12.5px] leading-5">
      {paint(text, 0, runs).map((piece, i) =>
        piece.category ? (
          <span key={i} className={CATEGORY_CLASS[piece.category]}>
            {piece.text}
          </span>
        ) : (
          piece.text
        ),
      )}
    </pre>
  );
}

const HEADING = [
  "",
  "text-lg",
  "text-base",
  "text-[15px]",
  "text-sm",
  "text-sm",
  "text-sm",
];

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading": {
            const Tag = `h${Math.min(6, block.level + 1)}` as "h2";
            return (
              <Tag
                key={i}
                className={cn(
                  "mt-4 mb-1.5 font-semibold text-text-high first:mt-0",
                  HEADING[block.level],
                )}
              >
                <Inline text={block.text} />
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={i} className="my-2 first:mt-0 last:mb-0">
                <Inline text={block.text} />
              </p>
            );
          case "code":
            return <Code key={i} lang={block.lang} text={block.text} />;
          case "math":
            return <MathSpan key={i} tex={block.text} display />;
          case "quote":
            return (
              <blockquote
                key={i}
                className="my-3 border-l-2 border-line-high pl-3 text-text-mid"
              >
                <Blocks blocks={block.blocks} />
              </blockquote>
            );
          case "rule":
            return <hr key={i} className="my-4 border-line" />;
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={i}
                className={cn(
                  "my-2 flex flex-col gap-1 pl-5",
                  block.ordered ? "list-decimal" : "list-disc",
                )}
              >
                {block.items.map((item, j) => (
                  <li key={j} className="pl-1 marker:text-text-low [&>p]:my-0">
                    <Blocks blocks={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "table":
            return (
              <div key={i} className="my-3 overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      {block.head.map((cell, j) => (
                        <th
                          key={j}
                          className="border-b border-line-high px-2 py-1 text-left font-semibold"
                        >
                          <Inline text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td
                            key={k}
                            className="border-b border-line px-2 py-1 align-top"
                          >
                            <Inline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}

export const Markdown = React.memo(function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={cn("text-sm leading-6 text-text-high", className)}>
      <Blocks blocks={blocks} />
    </div>
  );
});
