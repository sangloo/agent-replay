/** The library's state, which lives in the URL so Back returns to it. */

export type Tab = "sessions" | "saved";

export interface LibraryParams {
  tab: Tab;
  q: string;
  agent: string;
  /** A session's directory, or a saved replay's repository. */
  project: string;
  page: number;
}

export const PAGE_SIZE = 25;

export function parseLibrary(search: string): LibraryParams {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page"));
  return {
    tab: params.get("tab") === "saved" ? "saved" : "sessions",
    q: params.get("q") ?? "",
    agent: params.get("agent") ?? "",
    project: params.get("project") ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function libraryHash(params: LibraryParams): string {
  const search = new URLSearchParams();
  if (params.tab !== "sessions") search.set("tab", params.tab);
  if (params.q) search.set("q", params.q);
  if (params.agent) search.set("agent", params.agent);
  if (params.project) search.set("project", params.project);
  if (params.page > 1) search.set("page", String(params.page));
  const text = search.toString();
  return text ? `#/?${text}` : "#/";
}

/**
 * Learn's address: the project its courses are from (empty for all of them,
 * as in the library) and the course map open, if one is — so switching tabs
 * keeps the project, and Back returns to the same list.
 */
export function learnHash(project: string, key?: string): string {
  const search = project ? `?${new URLSearchParams({ project })}` : "";
  return `#/learn${key ? `/${key}` : ""}${search}`;
}
