import { test } from "@playwright/test";

const isTarget = (title: string) => title.includes("page rows drag without handles");

test.beforeEach(async ({ page }, info) => {
  if (!isTarget(info.title)) return;
  await page.addInitScript(() => {
    const signals: object[] = [];
    const state = window as Window & { notebookDragProbe?: object[] };
    state.notebookDragProbe = signals;
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const sensors = new Set<EventListenerOrEventListenerObject>();
    const isSensor = (event: string, listener: EventListenerOrEventListenerObject | null) =>
      event === "keydown" && typeof listener === "function" && listener.name === "bound handleKeyDown";
    EventTarget.prototype.addEventListener = function (event, listener, options) {
      if (this === document && isSensor(event, listener) && listener) {
        sensors.add(listener);
        signals.push({ event: "sensor-add", at: performance.now() });
      }
      add.call(this, event, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (event, listener, options) {
      if (this === document && isSensor(event, listener) && listener) {
        sensors.delete(listener);
        signals.push({ event: "sensor-remove", at: performance.now() });
      }
      remove.call(this, event, listener, options);
    };
    window.addEventListener("keydown", event => {
      if (!["Space", "ArrowUp"].includes(event.code)) return;
      signals.push({
        event: event.code, at: performance.now(), prevented: event.defaultPrevented, sensors: sensors.size,
        targetIsPage: event.target instanceof Element && event.target.hasAttribute("data-page-select"),
        ready: document.readyState,
      });
    });
  });
});

test.afterEach(async ({ page }, info) => {
  if (!isTarget(info.title)) return;
  const signals = await page.evaluate(() => (window as Window & { notebookDragProbe?: object[] }).notebookDragProbe);
  const evidence = { title: info.title, index: info.repeatEachIndex, status: info.status, signals };
  console.info("drag-probe", JSON.stringify(evidence));
  await info.attach("drag-probe", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
});
