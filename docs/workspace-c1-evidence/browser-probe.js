/* Optional DevTools Snippet. Read-only diagnostics, no requests or persistent storage. */
(() => {
  "use strict";
  const key = "__notebookWorkspaceProbe";
  if (window[key]) { console.info("Notebook probe already installed; reload the tab to start a new recording.");return; }
  const started = performance.now(), events = [], limit = 600;
  const push = (type, data) => { if (stopped) return;events.push({ ms: Math.round(performance.now() - started), type, ...data });if (events.length > limit) events.shift(); };
  const endpoint = value => {
    try {
      const url = new URL(value instanceof Request ? value.url : String(value), location.href);
      if (url.origin !== location.origin) return null;
      if (url.pathname === "/api/notebooks") return "notebooks";
      if (url.pathname === "/api/pages") return "page-list";
      if (/^\/api\/pages\/[^/]+$/.test(url.pathname)) return "page-document";
      if (url.pathname.startsWith("/api/auth/")) return "auth";
      return null;
    } catch { return null; }
  };
  const box = element => {
    if (!element) return null;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { width: Math.round(rect.width), height: Math.round(rect.height), display: style.display,
      visibility: style.visibility, opacity: style.opacity, scrollTop: Math.round(element.scrollTop),
      scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
  };
  let last = "", lastSample = performance.now(), root = null, tree = null, stopped = false;
  const sample = () => {
    if (stopped) return;
    const now = performance.now(), shell = document.querySelector(".notebook-app-shell"), current = shell?.querySelector(".notebook-navigation-tree") ?? null;
    if (now - lastSample > 1000 && document.visibilityState === "visible") push("sampling-gap", { durationMs: Math.round(now - lastSample) });lastSample = now;
    if (root && shell !== root) push("shell-replaced", {});
    if (tree && current !== tree) push("tree-replaced", {});root = shell;tree = current;
    const screen = shell?.getAttribute("data-workspace-screen");
    const state = { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      visible: document.visibilityState === "visible", screen: ["workspace", "search", "today", "stickers", "trash"].includes(screen) ? screen : null,
      shell: Boolean(shell), tree: box(current),
      books: current?.querySelectorAll("[data-notebook-title]").length ?? 0,
      sections: current?.querySelectorAll('[data-nav-row="section"]').length ?? 0,
      staticNavigation: Boolean(shell?.querySelector(".notebook-sidebar > button")),
      list: box(shell?.querySelector(".notebook-page-list")), pages: shell?.querySelectorAll("[data-page-title]").length ?? 0,
      editor: box(shell?.querySelector('.workspace-editor-slot[data-active="true"] .bn-editor')),
      loadingPlaceholders: shell?.querySelectorAll(".animate-pulse").length ?? 0 };
    const signature = JSON.stringify(state);if (signature !== last) { push("layout", state);last = signature; }
  };
  const originalFetch = window.fetch;
  async function observedFetch(input, init) {
    const category = endpoint(input), begin = performance.now();
    const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (category) push("http-start", { endpoint: category, method });
    try {
      const response = await originalFetch.call(this, input, init);
      if (category) push("http-end", { endpoint: category, method, status: response.status, durationMs: Math.round(performance.now() - begin) });
      // Inspect counts only, exclusively on the tree GET. Never inspect document/auth bodies.
      if (category === "notebooks" && method === "GET" && response.ok) {
        void response.clone().json().then(value => {
          if (stopped) return;
          if (!Array.isArray(value?.notebooks)) { push("tree-response", { validArray: false });return; }
          push("tree-response", { validArray: true, books: value.notebooks.length,
            sections: value.notebooks.reduce((count, book) => count + (Array.isArray(book?.sections) ? book.sections.length : 0), 0) });
        }).catch(() => { if (!stopped) push("tree-response-unreadable", {}); });
      }
      return response;
    } catch (error) {
      if (category && !stopped) push("http-failed", { endpoint: category, method, aborted: init?.signal?.aborted === true || error?.name === "AbortError" });
      throw error;
    }
  }
  const errorName = value => ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "AbortError", "NetworkError"].includes(value?.name) ? value.name : "Other";
  const onError = event => push("javascript-error", { name: errorName(event.error), line: event.lineno, column: event.colno });
  const onRejection = event => push("unhandled-rejection", { name: errorName(event.reason) });
  const observer = typeof PerformanceObserver !== "undefined" ? new PerformanceObserver(list => {
    for (const entry of list.getEntries()) push("long-task", { durationMs: Math.round(entry.duration) });
  }) : null;
  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) observer?.observe({ type: "longtask" });
  window.fetch = observedFetch;
  window.addEventListener("error", onError);window.addEventListener("unhandledrejection", onRejection);
  const timer = setInterval(sample, 250);sample();
  window[key] = {
    report() { sample();return JSON.stringify({ format: 1, elapsedMs: Math.round(performance.now() - started), events: [...events] }, null, 2); },
    stop() { sample();stopped = true;clearInterval(timer);observer?.disconnect();window.removeEventListener("error", onError);window.removeEventListener("unhandledrejection", onRejection);if (window.fetch === observedFetch) window.fetch = originalFetch;console.info("Notebook probe stopped. Report remains in memory until reload."); },
  };
  console.info("Notebook probe active. After the issue: copy(window.__notebookWorkspaceProbe.report()); window.__notebookWorkspaceProbe.stop()");
})();
