/**
 * Best-effort secret scrubbing for the prose a replay carries: prompts, the
 * agent's narration, shell commands and their output.
 *
 * File contents are deliberately NOT scrubbed. They are the code under
 * review, they are already in the repository, and a replay that silently
 * rewrote them would show the reviewer something that never existed. A
 * secret in a file is a finding, and the replay should show it.
 *
 * Pattern-based, so it is a net, not a guarantee: a replay is committed next
 * to the code it describes, and it should be read before it is shared further.
 */

const RULES: readonly [RegExp, string][] = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[redacted private key]",
  ],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, "[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "[redacted]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[redacted]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted]"],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, "[redacted]"],
  [/(\bBearer\s+)[\w.~+/=-]{16,}/gi, "$1[redacted]"],
  // Not a secret, but not the replay's business either: a replay is shared
  // wider than the terminal it came from.
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi, "[email]"],
  // A home folder names the person: `/Users/<name>/code/app` reads as
  // `~/code/app`, which says the same about the code and nothing about them.
  [/(?<![\w.~/-])\/(?:Users|home)\/[^/\s"'`:]+(?=\/|\b)/g, "~"],
  [/\b[A-Z]:\\Users\\[^\\\s"'`:]+/g, "~"],
  // An environment dump names the machine and the account it runs as.
  [/\b([A-Z][A-Z0-9_]*(?:UUID|_ID|EMAIL|ACCOUNT)[A-Z0-9_]*=)[^\s"']+/g, "$1[redacted]"],
  [
    /(\b[\w-]*(?:api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["']?)[^\s"'`,;]{8,}/gi,
    "$1[redacted]",
  ],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Keep the head and the tail — the command and its verdict. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  const dropped = text.length - head - tail;
  return `${text.slice(0, head)}\n… ${dropped} characters omitted …\n${text.slice(-tail)}`;
}
