import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import sharp from "sharp";
import youtube from "../src/lib/fixtures/saved-links/youtube.json";
import { extractSavedArticle } from "../src/lib/saved-article-extraction";
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

async function mobileAction(page: Page, name: string) {
  await detail(page).getByRole("button", { name: "Действия с материалом" }).click();
  const action = page.getByRole("menuitem", { name, exact: true });
  await action.click();
}

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
  await mobileAction(page, "Изменить");
  const edit = page.getByRole("dialog", { name: "Изменить материал" });
  await edit.getByLabel("Название", { exact: true }).fill("Маршрут и билеты");
  await edit.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(detail(page).getByRole("heading", { name: "Маршрут и билеты" })).toBeVisible();
  await mobileAction(page, "Отметить разобранным");
  await expect(detail(page).getByText("Разобрано", { exact: true })).toBeVisible();
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
  await expect(detail(page).getByRole("button", { name: "Действия с материалом" })).toBeHidden();
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

test("adopts the website title from the desktop and 360px detail", async ({ page, baseURL }) => {
  test.skip(process.env.SAVED_ITEM_TITLE_ORIGINS !== "1", "Requires the SavedItem title origins flag");
  test.setTimeout(120_000);
  await login(page);
  const fixtures = [
    { width: 1920, original: "Desktop manual title", site: "Desktop website title" },
    { width: 360, original: "Mobile manual title", site: "Mobile website title" },
  ];
  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    for (const { width, original, site } of fixtures) {
      const id = await capture(page, baseURL!, original);
      await client.query('UPDATE "SavedItem" SET "metadataTitle" = $1 WHERE id = $2', [site, id]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/app?view=saved");
      await card(page, original).click();
      await expect(detail(page).getByRole("heading", { name: original, exact: true })).toBeVisible();
      if (width === 360) await mobileAction(page, "Использовать заголовок сайта");
      else await detail(page).getByRole("button", { name: "Использовать заголовок сайта" }).click();
      await expect(detail(page).getByRole("heading", { name: site, exact: true })).toBeVisible();
      if (width === 360) await detail(page).getByRole("button", { name: "Назад", exact: true }).click();
      await expect(card(page, site)).toBeVisible();
    }
  } finally {
    await client.end();
  }
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

test("reads a local illustrated copy in Graphite and Atelier at all supported widths", async ({ page, baseURL }, info) => {
  test.setTimeout(120_000);
  await login(page);
  const origin = baseURL!;
  const remote = "https://field-notes.example.invalid/cedar-trail";
  const title = "Тропа вдоль кедрового ручья";
  const id = crypto.randomUUID();
  const outside: string[] = [];
  const preview: string[] = [];
  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    const notebook = await page.request.post("/api/notebooks", { data: { title: "Полевой журнал" } });
    expect(notebook.ok()).toBe(true);
    const { notebook: { id: notebookId } } = await notebook.json();
    const { rows: [{ id: userId }] } = await client.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', ["admin@example.test"]);
    const fixtures = [
      { alt: "Туман над кедровым ручьём", colors: ["#bacbc2", "#426854", "#152f2c", "#83ada4"] },
      { alt: "Открытая долина за перевалом", colors: ["#efcaa0", "#a77958", "#43382d", "#d8aa74"] },
      { alt: "Карта верхней тропы", colors: null },
    ];
    const images: { key: string; source: string; position: number; alt: string; uploadId: string | null }[] = [];
    for (const [position, { alt, colors }] of fixtures.entries()) {
      const source = `${remote}/figure-${position}.webp`;
      const key = createHash("sha256").update(source).digest("hex");
      let uploadId: string | null = null;
      if (colors) {
        const [sky, hills, forest, water] = colors;
        const vector = `<svg width="960" height="420" xmlns="http://www.w3.org/2000/svg">
          <rect width="960" height="420" fill="${sky}"/><circle cx="704" cy="103" r="48" fill="#f4e6c6"/>
          <path d="M0 238 145 126 261 211 377 94 488 220 620 145 758 218 870 142 960 196V420H0Z" fill="${hills}"/>
          <path d="M0 260Q155 235 334 278T609 272Q820 215 960 245V420H0Z" fill="${water}"/>
          <path d="M0 307 102 276 180 293 271 330 155 370 0 390ZM960 278 819 272 711 321 735 355 960 396Z" fill="${forest}"/>
          <path d="M0 337Q140 336 241 365T460 389M402 302Q563 285 693 306M511 343Q620 329 710 348" stroke="#f4e6c6" stroke-opacity=".4" stroke-width="5" fill="none"/>
          ${Array.from({ length: 16 }, (_, i) => {
            const x = i < 8 ? i * 30 : 725 + (i - 8) * 30;
            const y = (i < 8 ? 273 : 267) + (i * 17) % 27;
            return `<path d="M${x} ${y - 80}l-27 80h54z" fill="${forest}"/>`;
          }).join("")}</svg>`;
        const raster = await sharp(Buffer.from(vector)).webp({ quality: 86 }).toBuffer();
        const uploaded = await page.request.post("/api/uploads", { headers: { origin }, multipart: {
          notebookId, file: { name: `cedar-${position}.webp`, mimeType: "image/webp", buffer: raster },
        } });
        expect(uploaded.status()).toBe(201);
        uploadId = (await uploaded.json()).id;
      }
      images.push({ key, source, position, alt, uploadId });
    }
    await client.query(`INSERT INTO "SavedItem"(id,"userId",url,"metadataImageUrl","updatedAt")
      VALUES ($1,$2,$3,$4,now())`, [id, userId, remote, `${remote}/preview.webp`]);
    await page.setViewportSize({ width: 360, height: 960 });
    await page.goto(`/app?view=saved&item=${id}`);
    await expect(detail(page).getByText("Статья ещё не сохранена.")).toBeVisible();
    const enqueued = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/${id}/article`));
    await detail(page).getByRole("button", { name: "Сохранить статью" }).click();
    expect((await enqueued).status()).toBe(202);
    const text = (value: string) => [{ type: "text", text: value }];
    const image = (index: number) => ({ type: "image", key: images[index].key, alt: images[index].alt });
    const blocks = [
      { type: "heading", level: 1, content: text(title) },
      { type: "paragraph", content: text("Утром тропа спускается к воде. Отсюда хорошо слышно ручей, а за дальними кедрами проступает линия перевала.") },
      image(0),
      { type: "heading", level: 2, content: text("От ручья к перевалу") },
      { type: "listItem", ordered: true, depth: 0, content: text("Перейдите ручей по деревянному настилу.") },
      { type: "listItem", ordered: true, depth: 0, content: text("Держитесь левой тропы до открытой долины.") },
      { type: "listItem", ordered: false, depth: 1, content: text("На развилке ориентиром служит плоский валун.") },
      { type: "quote", content: text("Лучше остановиться у воды: здесь лес тише, чем на подъёме.") },
      image(1), image(2),
      { type: "paragraph", content: [{ type: "link", text: "Заметки о маршруте", href: `${remote}/notes` }] },
    ];
    await client.query("BEGIN");
    try {
      await client.query(`INSERT INTO "SavedArticle"("savedItemId","sourceUrl","contentVersion",blocks,"extractedAt")
        VALUES ($1,$2,2,$3,$4)`, [id, remote, JSON.stringify(blocks), new Date("2026-10-18T10:00:00Z")]);
      for (const { key, source, position, uploadId } of images) {
        await client.query(`INSERT INTO "SavedArticleImage"("savedItemId","imageKey","sourceUrl",position,"uploadId")
          VALUES ($1,$2,$3,$4,$5)`, [id, key, source, position, uploadId]);
      }
      await client.query(`UPDATE "SavedArticleJob" SET status = 'ready', "finishedAt" = now(), reason = NULL, "leaseToken" = NULL, "leaseUntil" = NULL
        WHERE "savedItemId" = $1`, [id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    await expect(detail(page).getByRole("heading", { name: title, exact: true })).toBeVisible();
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.hostname === new URL(remote).hostname) outside.push(request.url());
      if (url.pathname === `/api/saved-items/${id}/preview`) preview.push(request.url());
    });
    for (const theme of ["studio-graphite", "studio-atelier"]) {
      await setTestTheme(page, theme);
      for (const width of [360, 768, 1920]) {
        await page.setViewportSize({ width, height: 960 });
        await page.goto(`/app?view=saved&item=${id}`);
        await expect(page.locator("html")).toHaveClass(theme);
        const article = detail(page).getByRole("region", { name: "Сохранённая статья" });
        await expect(detail(page).getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect(detail(page).getByRole("link", { name: "Открыть оригинал" })).toHaveAttribute("href", remote);
        await expect(detail(page).getByText("Часть изображений недоступна.")).toBeVisible();
        await expect(article.getByText("Изображение недоступно · Карта верхней тропы")).toBeAttached();
        await expect(article.locator("ol > li > ul")).toHaveCount(1);
        await expect(article.locator("blockquote")).toHaveCount(1);
        await expect(article.getByRole("link", { name: "Заметки о маршруте" })).toHaveAttribute("href", `${remote}/notes`);
        await expect(article.getByRole("img")).toHaveCount(2);
        const lead = article.getByRole("img", { name: images[0].alt });
        await expect.poll(() => lead.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(960);
        const second = article.getByRole("img", { name: images[1].alt });
        await second.scrollIntoViewIfNeeded();
        await expect.poll(() => second.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(960);
        await detail(page).getByRole("heading", { name: title, exact: true }).evaluate(node => node.scrollIntoView());
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: info.outputPath(`${theme}-${width}.png`), animations: "disabled" });
      }
    }
    expect(outside).toEqual([]);
    expect(preview).toEqual([]);
    await client.query(`UPDATE "SavedArticleJob" SET status = 'failed', "finishedAt" = now(), reason = 'request'
      WHERE "savedItemId" = $1`, [id]);
    await page.reload();
    await expect(detail(page).getByText("Обновление не удалось. Доступна предыдущая копия.")).toBeVisible();
    await expect(detail(page).getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(detail(page).getByRole("button", { name: "Обновить копию" })).toBeEnabled();
    await client.query(`UPDATE "SavedItem" SET title = $2, "titleOrigin" = 'manual' WHERE id = $1`, [id, "Мой заголовок маршрута"]);
    await page.reload();
    await expect(detail(page).getByRole("heading", { name: "Мой заголовок маршрута", level: 2 })).toBeVisible();
    await expect(detail(page).getByRole("heading", { name: title, level: 3 })).toBeVisible();
  } finally {
    await client.end();
  }
});

test("server paginates the feed and the running worker preserves blocked links", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await login(page);
  await setTestTheme(page, "studio-graphite");
  for (let index = 0; index < 26; index++) {
    await capture(page, baseURL!, `Пакетматериалов ${String(index).padStart(2, "0")}`);
  }
  const longTitle = "Как выбрать инструменты для небольшой домашней мастерской и подобрать комплект для ремонта ".repeat(2).trim();
  const blocked = await page.request.post("/api/saved-items", {
    headers: { origin: baseURL!, "idempotency-key": `e2e-${crypto.randomUUID()}` },
    data: { title: longTitle, text: "Исходный текст остаётся доступен", url: "http://127.0.0.1/" },
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
  await expect(detail(page).getByText("Ошибка получения превью.", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(detail(page).getByText("Сохранена карточка", { exact: true })).toBeVisible();
  await compact(page, 360);
  const heading = detail(page).getByRole("heading", { name: longTitle, exact: true });
  const headingLines = () => heading.evaluate(element => element.clientHeight / parseFloat(getComputedStyle(element).lineHeight));
  await expect.poll(headingLines).toBeCloseTo(3);
  await detail(page).getByRole("button", { name: "Показать весь заголовок" }).click();
  await expect.poll(headingLines).toBeGreaterThan(3);
  await detail(page).getByRole("button", { name: "Свернуть заголовок" }).click();
  await expect.poll(headingLines).toBeCloseTo(3);
  await expect(detail(page).getByText("Исходный текст остаётся доступен", { exact: true })).toBeVisible();
  await expect(detail(page).getByRole("link", { name: "Открыть источник" })).toHaveAttribute("href", "http://127.0.0.1/");
  await detail(page).getByRole("button", { name: "Действия с материалом" }).click();
  await expect(page.getByRole("menuitem", { name: "Повторить получение превью" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as typeof window & { __NOTEBOOK_ANDROID_BACK__?: () => string }).__NOTEBOOK_ANDROID_BACK__?.());
  await expect(page).toHaveURL(/\/app\?view=saved$/);
  await expect(list(page)).toBeVisible();
});

test("shows provider cards, restricted sources and older copies on desktop and 360 px mobile", async ({ page }, info) => {
  test.setTimeout(120_000);
  await login(page);
  await setTestTheme(page, "studio-atelier");
  const cases = [
    { name: "youtube", url: "https://youtu.be/testVideo_1", title: youtube.title, kind: "Видео",
      siteName: `YouTube · ${youtube.author_name}`, cover: youtube.thumbnail_url },
    { name: "vk-clip", url: "https://vk.com/clip-123_456", title: "Туман над озером", kind: "Видео",
      siteName: "VK Клипы", cover: "https://covers.example.test/lake.webp", description: "Первые минуты рассвета на берегу озера." },
    { name: "threads", url: "https://www.threads.net/@notes/post/Cabc123", title: "Наблюдения с берега", kind: "Публикация",
      siteName: "Threads", description: "У воды уже появились первые следы весны." },
    { name: "restricted", url: "https://threads.com/@notes/post/Cblocked1", title: "Полевые заметки с Android", kind: "Публикация", failure: "access" },
    { name: "no-preview", url: "https://vk.com/clip-321_654", title: "Вечерний маршрут", kind: "Видео" },
    { name: "old-copy", url: "https://youtu.be/oldVideo_12", title: "Старая запись о маршруте", kind: "Видео", hasArticle: true, cover: youtube.thumbnail_url },
    { name: "html", url: "https://field-notes.example.invalid/review/entry", title: "Маршрут к верховью ручья", kind: "Ссылка" },
  ].map(fixture => ({ ...fixture, id: crypto.randomUUID() }));

  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows: [{ id: userId }] } = await client.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', ["admin@example.test"]);
    for (const fixture of cases) {
      const hasMetadata = fixture.siteName !== undefined;
      await client.query(`INSERT INTO "SavedItem"(id,"userId",url,"titleOrigin","sharedTitle","metadataTitle",
        "metadataDescription","metadataSiteName","metadataImageUrl","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`, [fixture.id, userId, fixture.url, hasMetadata ? "system" : "share",
        hasMetadata ? null : fixture.title, hasMetadata ? fixture.title : null, fixture.description, fixture.siteName, fixture.cover]);
      await client.query(`INSERT INTO "SavedItemMetadataJob"("savedItemId","finishedAt",failed,"failureReason")
        VALUES ($1,now(),$2,$3)`, [fixture.id, Boolean(fixture.failure), fixture.failure]);
      if (fixture.hasArticle) {
        const blocks = [{ type: "paragraph", content: [{ type: "text", text: "Этот текст доступен из старой локальной копии." }] }];
        await client.query(`INSERT INTO "SavedArticle"("savedItemId","sourceUrl","contentVersion",blocks,"extractedAt")
          VALUES ($1,$2,1,$3,now())`, [fixture.id, fixture.url, JSON.stringify(blocks)]);
      }
    }
    // The browser uses local raster bytes through the app's preview path. Transport and ownership are tested separately.
    const cover = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="405" viewBox="0 0 720 405">
      <path fill="#d1d9ce" d="M0 0h720v405H0z"/><circle fill="#eee0ba" cx="543" cy="97" r="45"/>
      <path fill="#85988b" d="M0 232 111 127l90 64 107-87 116 106 92-69 204 108v156H0Z"/>
      <path fill="#47695d" d="M0 260q139-50 295-17 189 46 425-20v182H0Z"/>
      <path fill="#98b2a7" d="M0 310q195-64 407-25 176 25 313-14v134H0Z"/>
      <path fill="#27483e" d="M0 355q122-36 242 0 244 48 478-18v68H0Z"/>
      <path fill="#27483e" d="m74 310 36-107 36 107zm-48 22 27-81 27 81zm542-15 43-133 43 133zm76 19 34-105 34 105z"/>
    </svg>`)).webp().toBuffer();
    await page.route(/\/api\/saved-items\/[^/]+\/preview$/u, route => route.fulfill({ contentType: "image/webp", body: cover }));
    const articleReads = new Set<string>();
    page.on("request", request => {
      const article = new URL(request.url()).pathname.match(/^\/api\/saved-items\/([^/]+)\/article$/u);
      if (article) articleReads.add(article[1]);
    });
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 900 });
      for (const fixture of cases) {
        await page.goto(`/app?view=saved&item=${fixture.id}`);
        const material = detail(page);
        await expect(material.getByRole("heading", { name: fixture.title })).toBeVisible();
        await expect(material.getByText(fixture.kind, { exact: true })).toBeVisible();
        await expect(material.getByRole("link", { name: "Открыть источник" })).toHaveAttribute("href", fixture.url);
        await expect(material.getByText(fixture.hasArticle ? "Сохранена статья" : "Сохранена карточка", { exact: true })).toBeVisible();
        if (fixture.kind === "Ссылка") await expect(material.getByRole("button", { name: "Сохранить статью" })).toBeEnabled();
        else await expect(material.getByRole("button", { name: /Сохранить статью|Обновить копию/ })).toHaveCount(0);
        if (fixture.siteName) await expect(material.getByText(fixture.siteName, { exact: true })).toBeVisible();
        if (fixture.description) await expect(material.getByText(fixture.description, { exact: true })).toBeVisible();
        if (fixture.cover) {
          const image = material.locator(`img[src="/api/saved-items/${fixture.id}/preview"]`);
          await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(720);
        }
        if (fixture.failure) await expect(material.getByText("Источник ограничил доступ")).toBeVisible();
        if (!fixture.siteName && !fixture.failure && !fixture.cover) {
          await expect(material.getByText(fixture.kind === "Видео" ? "Нет доступной обложки." : "Превью недоступно")).toBeVisible();
        }
        if (fixture.hasArticle) await expect(material.getByRole("region", { name: "Сохранённая статья" })).toBeVisible();
        await expect(material.getByText("Получаем превью…")).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        if (["youtube", "vk-clip", "threads", "restricted", "old-copy"].includes(fixture.name)) {
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: info.outputPath(`${fixture.name}-${width}.png`), animations: "disabled" });
        }
      }
      if (width === 360) {
        await expect(list(page)).toBeHidden();
        await detail(page).getByRole("button", { name: "Назад", exact: true }).click();
        await expect(list(page)).toBeVisible();
      }
    }
    expect([...articleReads].sort()).toEqual(cases.filter(fixture => fixture.hasArticle || fixture.kind === "Ссылка").map(fixture => fixture.id).sort());
  } finally {
    await client.query('DELETE FROM "SavedItem" WHERE id = ANY($1::text[])', [cases.map(fixture => fixture.id)]);
    await client.end();
  }
});

test("distinguishes cover failures, article access and legacy service pages on desktop and 360 px", async ({ page }, info) => {
  test.setTimeout(120_000);
  await login(page);
  await setTestTheme(page, "studio-atelier");
  const pikabu = readFileSync("src/lib/fixtures/saved-links/pikabu-story.html", "utf8");
  const story = extractSavedArticle(pikabu, new URL("https://pikabu.ru/story/example"));
  if (story.status !== "ready") throw new Error("Story fixture was not extracted");
  const files = await sharp({ create: { width: 240, height: 135, channels: 3, background: "#7a9385" } }).webp().toBuffer();
  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
  const ids: string[] = [];
  await client.connect();
  try {
    const { rows: [{ id: userId }] } = await client.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', ["admin@example.test"]);
    async function seed(title: string, url: string, failure?: string, cover?: string) {
      const id = crypto.randomUUID();
      ids.push(id);
      await client.query(`INSERT INTO "SavedItem"(id,"userId",url,"titleOrigin","sharedTitle","metadataImageUrl","updatedAt")
        VALUES ($1,$2,$3,'share',$4,$5,now())`, [id, userId, url, title, cover]);
      await client.query(`INSERT INTO "SavedItemMetadataJob"("savedItemId","finishedAt",failed,"failureReason")
        VALUES ($1,now() - interval '2 minutes',$2,$3)`, [id, Boolean(failure), failure]);
      return id;
    }
    async function saveCopy(id: string, url: string, blocks: unknown, version = 1) {
      await client.query(`INSERT INTO "SavedArticle"("savedItemId","sourceUrl","contentVersion",blocks,"extractedAt")
        VALUES ($1,$2,$3,$4,now())`, [id, url, version, JSON.stringify(blocks)]);
    }
    const dnsTitle = "Как выбрать набор ручного инструмента";
    const dnsUrl = "https://club.dns-shop.ru/blog/example/";
    const dns = await seed(dnsTitle, dnsUrl, "access");
    await client.query(`INSERT INTO "SavedArticleJob"("savedItemId","sourceUrl",generation,status,"finishedAt",reason)
      VALUES ($1,$2,$1,'fallback',now(),'access')`, [dns, dnsUrl]);
    const youtubeUrl = "https://youtu.be/testVideo_1";
    const metadataError = await seed("Сбой сети при получении видео", youtubeUrl, "timeout");
    const missing = await seed("Видео без обложки", youtubeUrl);
    const cover = await seed("Видео с обложкой", youtubeUrl, undefined, youtube.thumbnail_url);
    const vkUrl = "https://vk.ru/wall-123_456";
    const vk = await seed("Публикация ВКонтакте", vkUrl, "access");
    await saveCopy(vk, vkUrl, [
      { type: "heading", level: 1, content: [{ type: "text", text: "Ваш браузер устарел" }] },
      { type: "paragraph", content: [{ type: "text", text: "Обновите свой браузер или выберите другой." }] },
    ]);
    const pikabuUrl = "https://pikabu.ru/story/example";
    const storyId = await seed("Пример публикации", pikabuUrl);
    await saveCopy(storyId, pikabuUrl, story.blocks, 2);
    await page.route(new RegExp(`/api/saved-items/${cover}/preview(?:\\?.*)?$`), route =>
      new URL(route.request().url()).searchParams.has("retry")
        ? route.fulfill({ contentType: "image/webp", body: files })
        : route.fulfill({ status: 502, json: { failure: "http" } }));
    // These raster responses render the locally extracted image blocks without contacting the article site.
    const readerImages = story.imageCandidates?.map(({ key }) => ({ key, url: `/api/saved-items/${storyId}/article/images/${key}` })) ?? [];
    await page.route(`**/api/saved-items/${storyId}/article`, async route => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, article: { ...body.article, images: readerImages } } });
    });
    await page.route(`**/api/saved-items/${storyId}/article/images/*`, route => route.fulfill({ contentType: "image/webp", body: files }));
    const material = detail(page);
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 900 });
      const open = async (id: string, title: string) => {
        await page.goto(`/app?view=saved&item=${id}`);
        await expect(material.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      };
      async function captureState(name: string) {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), animations: "disabled" });
      }
      await open(dns, dnsTitle);
      await expect(material.getByText("Сохранена карточка", { exact: true })).toBeVisible();
      await expect(material.getByText("Источник ограничил доступ к превью.", { exact: true })).toBeVisible();
      await expect(material.getByText("Источник ограничил доступ к статье.", { exact: true })).toBeVisible();
      await expect(material.getByRole("link", { name: "Открыть источник" })).toHaveAttribute("href", dnsUrl);
      await captureState("dns-club");
      await open(metadataError, "Сбой сети при получении видео");
      await expect(material.getByText("Источник не ответил вовремя при получении превью.")).toBeVisible();
      await open(missing, "Видео без обложки");
      await expect(material.getByText("Нет доступной обложки.")).toBeVisible();
      await open(cover, "Видео с обложкой");
      await expect(material.getByText("Не удалось загрузить обложку.")).toBeVisible();
      await captureState("youtube-preview-error");
      await material.getByRole("button", { name: "Повторить загрузку обложки" }).click();
      await expect.poll(() => material.locator('img[src*="/preview?retry="]').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(240);
      await open(storyId, "Пример публикации");
      const storyReader = material.getByRole("region", { name: "Сохранённая статья" });
      await expect(storyReader.getByRole("img")).toHaveCount(2);
      await expect(storyReader.locator("p + figure + p + p + figure + p")).toHaveCount(1);
      await captureState("pikabu");
      await open(vk, "Публикация ВКонтакте");
      await expect(material.getByText("Вместо материала сохранена страница обновления браузера.")).toBeVisible();
      await expect(material.getByText("Сохранена статья", { exact: true })).toHaveCount(0);
      await expect(material.getByRole("region", { name: "Служебная копия" })).toBeVisible();
      await captureState("vk");
    }
    page.once("dialog", dialog => dialog.dismiss());
    await material.getByRole("button", { name: "Удалить служебную копию" }).click();
    await expect(material.getByRole("region", { name: "Служебная копия" })).toBeVisible();
    page.once("dialog", dialog => dialog.accept());
    await material.getByRole("button", { name: "Удалить служебную копию" }).click();
    await expect(material.getByRole("region", { name: "Служебная копия" })).toHaveCount(0);
    await expect(material.getByRole("link", { name: "Открыть источник" })).toHaveAttribute("href", vkUrl);
  } finally {
    await client.query('DELETE FROM "SavedItem" WHERE id = ANY($1::text[])', [ids]);
    await client.end();
  }
});
