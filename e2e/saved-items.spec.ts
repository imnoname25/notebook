import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { Client } from "pg";
import sharp from "sharp";
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
  await expect(detail(page).getByText("Ссылка сохранена. Не удалось получить данные для превью.", { exact: true })).toBeVisible({ timeout: 15_000 });
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
