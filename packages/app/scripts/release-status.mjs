import { appendFileSync, readFileSync } from "node:fs";
import process from "node:process";

const { name, version } = JSON.parse(
  readFileSync(new URL("../publish.json", import.meta.url), "utf8"),
);
// A registry failure must fail the job, not masquerade as an unpublished version.
const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
if (!response.ok) throw new Error(`Registry lookup failed: ${response.status}`);
const metadata = await response.json();
const publish = !Object.hasOwn(metadata.versions, version);
console.warn(
  `${name}@${version}: ${publish ? "ready to publish" : "already published; skipping"}`,
);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
}
