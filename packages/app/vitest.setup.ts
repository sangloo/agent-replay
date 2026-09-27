import "@testing-library/jest-dom/vitest";

// jsdom lacks the layout APIs the player's panels measure with. The server's
// tests run under Node, where there is no window at all.
if (typeof window !== "undefined") {
  class NoResize {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  Element.prototype.scrollTo ??= function scrollTo() {};
}
