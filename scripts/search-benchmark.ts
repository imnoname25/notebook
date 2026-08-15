import { randomUUID } from "node:crypto";

const url = process.env.BENCHMARK_DATABASE_URL;
if (!url || process.env.BENCHMARK_ALLOW_WRITES !== "1") throw new Error("Задайте отдельную BENCHMARK_DATABASE_URL и BENCHMARK_ALLOW_WRITES=1");
if (!/(?:test|benchmark|dev)/iu.test(url)) throw new Error("Benchmark database URL должна явно содержать test, benchmark или dev");
process.env.DATABASE_URL = url;

const count = Math.min(Math.max(Number(process.argv[2] ?? 1000), 1000), 10_000);
const { db } = await import("../src/lib/db");
const { searchNotebook } = await import("../src/lib/services/search-service");
const userId = `benchmark-${randomUUID()}`;
try {
  const user = await db.user.create({ data: { id: userId, email: `${userId}@example.invalid`, name: "Search benchmark", passwordHash: "not-a-login" } });
  const notebook = await db.notebook.create({ data: { userId: user.id, title: "Benchmark notebook" } });
  const section = await db.section.create({ data: { notebookId: notebook.id, title: "Инфраструктура Infrastructure" } });
  const rows = Array.from({ length: count }, (_, index) => ({ id: randomUUID(), sectionId: section.id, title: index % 100 === 0 ? `PostgreSQL резервная копия ${index}` : `Страница ${index}`, content: [{ type: "paragraph", content: [{ type: "text", text: `docker backup postgres уникальный маркер ${index}`, styles: {} }] }], searchText: `docker backup postgres резервное копирование unique marker ${index}`, sortOrder: index }));
  for (let offset = 0; offset < rows.length; offset += 500) await db.page.createMany({ data: rows.slice(offset, offset + 500) });
  for (const query of ["postgresql", "резервное копирование", "postgr", "docker backup"]) { const started = performance.now(); const result = await searchNotebook(user.id, query); console.info(`${query}: ${(performance.now() - started).toFixed(1)} ms · ${result.results.length} results`); }
} finally { await db.user.deleteMany({ where: { id: userId } }); await db.$disconnect(); }
