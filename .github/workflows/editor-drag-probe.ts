import { test, type Page } from "@playwright/test";

const isTarget = (title: string) => title.includes("page rows drag without handles");
const isOrder = (title: string) => title.includes("page order persists rapid intents");
const diagnostics = new WeakMap<Page, object[]>();

test.beforeEach(async ({ page }, info) => {
  if (isOrder(info.title)) {
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/reorder/pages") console.info("order-probe request", request.method());
    });
    page.on("requestfailed", request => {
      if (new URL(request.url()).pathname === "/api/reorder/pages") console.info("order-probe failure", request.failure()?.errorText);
    });
    page.on("pageerror", error => console.info("order-probe browser exception", error.name));
  }
  if (!isTarget(info.title)) return;
  const signals: object[] = [];
  await page.exposeBinding("recordKeyboardDragProbe", (_source, value: object) => { signals.push(value); });
  await page.addInitScript(() => {
    const signal = (value: object) =>
      void (window as unknown as { recordKeyboardDragProbe(value: object): Promise<void> }).recordKeyboardDragProbe(value);
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const sensors = new Set<EventListenerOrEventListenerObject>();
    const isSensor = (event: string, listener: EventListenerOrEventListenerObject | null) =>
      event === "keydown" && typeof listener === "function" && listener.name === "bound handleKeyDown";
    EventTarget.prototype.addEventListener = function (event, listener, options) {
      if (this === document && isSensor(event, listener) && listener) {
        sensors.add(listener);
        signal({ event: "sensor-add", at: performance.now() });
      }
      add.call(this, event, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (event, listener, options) {
      if (this === document && isSensor(event, listener) && listener) {
        sensors.delete(listener);
        signal({ event: "sensor-remove", at: performance.now() });
      }
      remove.call(this, event, listener, options);
    };
    window.addEventListener("keydown", event => {
      if (!["Space", "ArrowUp"].includes(event.code)) return;
      signal({
        event: event.code, at: performance.now(), prevented: event.defaultPrevented, sensors: sensors.size,
        targetIsPage: event.target instanceof Element && event.target.hasAttribute("data-page-select"),
        ready: document.readyState,
      });
    });
  });
  diagnostics.set(page, signals);
});

test.afterEach(async ({ page }, info) => {
  if (!isTarget(info.title)) return;
  const signals = diagnostics.get(page);
  const evidence = { title: info.title, index: info.repeatEachIndex, status: info.status, signals };
  console.info("drag-probe", JSON.stringify(evidence));
  await info.attach("drag-probe", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
});
