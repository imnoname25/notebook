import { expect, test, type Page } from "@playwright/test";
import { setTestTheme } from "./theme-fixture";

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", { data: {
    email: "admin@example.test", password: "correct horse battery staple",
  } });
  expect(response.ok()).toBe(true);
}

async function destinations(page: Page, label: string) {
  const notebook = await page.request.post("/api/notebooks", { data: { title: `Блокнот ${label}` } });
  expect(notebook.ok()).toBe(true);
  const { notebook: { id } } = await notebook.json();
  const section = await page.request.post("/api/sections", { data: { notebookId: id, title: `Раздел ${label}` } });
  expect(section.ok()).toBe(true);
  return (await section.json()).section.id as string;
}

async function capture(page: Page, origin: string, title: string, text = "", tags: string[] = []) {
  const response = await page.request.post("/api/saved-items", { headers: {
    origin, "idempotency-key": `e2e-${crypto.randomUUID()}`,
  }, data: { title, text, tags } });
  expect(response.status()).toBe(201);
  return (await response.json()).item.id as string;
}

const list = (page: Page) => page.getByRole("region", { name: "Сохранённое", exact: true });
const detail = (page: Page) => page.getByRole("region", { name: "Материал", exact: true });
const card = (page: Page, title: string) => list(page).getByRole("button", { name: new RegExp(title) });
const destination = (page: Page) => page.locator(".notebook-sidebar").getByRole("button", { name: "Сохранённое", exact: true });

async function compact(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await expect.poll(() => page.locator(".notebook-workspace-grid").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(width < 1200 ? 1 : 3);
}

test("mobile capture, search, archive, restore, transfer and delete", async ({ page, baseURL }, info) => {
  test.setTimeout(120_000);
  await login(page);
  await setTestTheme(page, "studio-graphite");
  const sectionId = await destinations(page, "поездки");
  await capture(page, baseURL!, "Книжный список", "Записать рекомендации после встречи", ["чтение"]);
  await capture(page, baseURL!, "Идеи для поездки", "Посмотреть маршруты вдоль берега", ["поездка"]);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/app?view=saved");
  await expect(list(page)).toBeVisible();
  await compact(page, 360);
  await page.getByRole("button", { name: "Открыть навигацию", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Навигация" })).toBeVisible();
  await destination(page).click();
  await expect(page.getByRole("dialog", { name: "Навигация" })).toHaveCount(0);
  await list(page).getByRole("button", { name: "Добавить", exact: true }).click();
  const captureDialog = page.getByRole("dialog", { name: "Добавить материал" });
  await captureDialog.getByLabel("Название", { exact: true }).fill("Билеты и заметки");
  await captureDialog.getByLabel("Текст", { exact: true }).fill("Маршрут на выходные и адрес места встречи");
  await captureDialog.getByLabel("Теги через пробел или запятую").fill("поездка");
  await captureDialog.getByLabel("Изображения или PDF").setInputFiles({
    name: "билеты.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF"),
  });
  await captureDialog.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(detail(page).getByRole("heading", { name: "Билеты и заметки" })).toBeVisible();
  await expect(detail(page).getByRole("link", { name: "билеты.pdf · PDF" })).toBeVisible();
  await expect(list(page)).toBeHidden();
  await detail(page).getByRole("button", { name: "Изменить", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Изменить материал" });
  await edit.getByLabel("Название", { exact: true }).fill("Маршрут и билеты");
  await edit.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(detail(page).getByRole("heading", { name: "Маршрут и билеты" })).toBeVisible();
  await detail(page).getByRole("button", { name: "Отметить разобранным" }).click();
  await expect(detail(page).getByRole("button", { name: "Отметить неразобранным" })).toBeVisible();
  await detail(page).getByRole("button", { name: "Назад", exact: true }).click();
  await expect(list(page)).toBeVisible();
  await list(page).getByRole("button", { name: "Неразобранное", exact: true }).click();
  await expect(card(page, "Идеи для поездки")).toBeVisible();
  await expect(card(page, "Маршрут и билеты")).toHaveCount(0);
  await list(page).getByRole("button", { name: "Все", exact: true }).click();
  await expect(card(page, "Маршрут и билеты")).toBeVisible();
  await page.screenshot({ path: info.outputPath("saved-mobile-360.png") });
  await list(page).getByRole("button", { name: "#чтение", exact: true }).click();
  await expect(card(page, "Книжный список")).toBeVisible();
  await expect(card(page, "Маршрут и билеты")).toHaveCount(0);
  await list(page).getByRole("button", { name: /Сбросить фильтр/ }).click();
  await list(page).getByRole("searchbox", { name: "Поиск в сохранённом" }).fill("Маршрут и билеты");
  await expect(card(page, "Маршрут и билеты")).toBeVisible();
  await expect(card(page, "Книжный список")).toHaveCount(0);
  await card(page, "Маршрут и билеты").click();
  await compact(page, 840);
  await expect(detail(page).getByRole("heading", { name: "Маршрут и билеты" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("saved-fold-840.png") });
  await compact(page, 1920);
  await expect(list(page)).toBeVisible();
  await page.screenshot({ path: info.outputPath("saved-desktop-1920.png") });
  await detail(page).getByRole("button", { name: "Архивировать", exact: true }).click();
  await expect(detail(page).getByRole("button", { name: "Восстановить", exact: true })).toBeVisible();
  await detail(page).getByRole("button", { name: "Назад", exact: true }).click();
  await list(page).getByRole("button", { name: "Архив", exact: true }).click();
  await card(page, "Маршрут и билеты").click();
  await detail(page).getByRole("button", { name: "Восстановить", exact: true }).click();
  await expect(detail(page).getByRole("button", { name: "Архивировать", exact: true })).toBeVisible();
  const savedUrl = page.url();
  await detail(page).getByRole("button", { name: "Перенести в страницу", exact: true }).click();
  const transfer = page.getByRole("dialog", { name: "Перенести в страницу" });
  await transfer.getByLabel("Блокнот и раздел").selectOption(sectionId);
  await transfer.getByRole("button", { name: "Перенести", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByLabel("Название страницы", { exact: true })).toHaveValue("Маршрут и билеты", { timeout: 20_000 });
  await page.goBack();
  await expect(page).toHaveURL(savedUrl);
  await expect(detail(page).getByRole("button", { name: "Открыть страницу", exact: true })).toBeVisible();
  await detail(page).getByRole("button", { name: "Удалить", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Удалить материал?" });
  await deletion.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(detail(page).getByRole("heading", { name: "Маршрут и билеты" })).toBeVisible();
  await detail(page).getByRole("button", { name: "Удалить", exact: true }).click();
  await deletion.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page).toHaveURL(/\/app\?view=saved$/);
});

test("Atelier opens an exact global result and retains both split panes on Back", async ({ page, baseURL }, info) => {
  test.setTimeout(120_000);
  await login(page);
  await setTestTheme(page, "studio-atelier");
  const sectionId = await destinations(page, "исследования");
  const a = await page.request.post("/api/pages", { data: { sectionId, title: "План исследования" } }).then(response => response.json());
  const b = await page.request.post("/api/pages", { data: { sectionId, title: "Источники исследования" } }).then(response => response.json());
  const savedId = await capture(page, baseURL!, "Полевые наблюдения", "Аудиозапись разговора на станции", ["исследование"]);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/pages/${a.page.id}`);
  const left = page.locator('.workspace-editor-slot[data-pane="left"]');
  const right = page.locator('.workspace-editor-slot[data-pane="right"]');
  const title = (pane: typeof left) => pane.getByLabel("Название страницы", { exact: true });
  const search = async (query: string) => {
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Быстрый поиск", exact: true }).fill(query);
    await page.getByRole("region", { name: "Быстрый поиск документов" }).getByRole("option", { name: new RegExp(query) }).first().click();
  };
  await expect(title(left)).toHaveValue(a.page.title);
  await left.getByRole("button", { name: "Split View", exact: true }).click();
  await search(b.page.title);
  await expect(title(right)).toHaveValue(b.page.title);
  await left.locator(".bn-inline-content").first().click();
  await page.keyboard.type("Saved transition marker");
  await search("Полевые наблюдения");
  await expect(page).toHaveURL(new RegExp(`/app\\?view=saved&item=${savedId}$`));
  await expect(detail(page).getByRole("heading", { name: "Полевые наблюдения" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("saved-atelier-desktop.png") });
  await page.goBack();
  await expect(title(left)).toHaveValue(a.page.title);
  await expect(title(right)).toHaveValue(b.page.title);
  await expect(left.locator(".bn-editor")).toContainText("Saved transition marker");
  await expect.poll(async () => JSON.stringify(await page.request.get(`/api/pages/${a.page.id}`).then(r => r.json()))).toContain("Saved transition marker");
});

test("server paginates the feed and the running worker preserves blocked links", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await login(page);
  await setTestTheme(page, "studio-graphite");
  for (let index = 0; index < 26; index++) {
    await capture(page, baseURL!, `Пакетматериалов ${String(index).padStart(2, "0")}`);
  }
  const blocked = await page.request.post("/api/saved-items", {
    headers: { origin: baseURL!, "idempotency-key": `e2e-${crypto.randomUUID()}` },
    data: { title: "Локальный адрес", text: "Исходный текст остаётся доступен", url: "http://127.0.0.1/" },
  });
  expect(blocked.status()).toBe(201);
  const { item } = await blocked.json();
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/app?view=saved");
  const search = list(page).getByRole("searchbox", { name: "Поиск в сохранённом" });
  const filtered = page.waitForResponse(response => new URL(response.url()).searchParams.get("q") === "Пакетматериалов" && response.ok());
  await search.fill("Пакетматериалов");
  await filtered;
  await expect(list(page).getByRole("listitem")).toHaveCount(25);
  await list(page).getByRole("button", { name: "Показать ещё" }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(26);
  await expect(list(page).getByRole("button", { name: "Показать ещё" })).toHaveCount(0);
  await page.goto(`/app?view=saved&item=${item.id}`);
  await expect(detail(page).getByText("Метаданные недоступны.", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(detail(page).getByText("Исходный текст остаётся доступен", { exact: true })).toBeVisible();
  await expect(detail(page).getByRole("link", { name: "Открыть источник" })).toHaveAttribute("href", "http://127.0.0.1/");
  await page.evaluate(() => (window as typeof window & { __NOTEBOOK_ANDROID_BACK__?: () => string }).__NOTEBOOK_ANDROID_BACK__?.());
  await expect(page).toHaveURL(/\/app\?view=saved$/);
  await expect(list(page)).toBeVisible();
});
