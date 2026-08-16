#!/usr/bin/env node
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createRecoveryDatabase } from "./admin-recovery-db.mjs";
import { recoverAdministrator } from "./admin-recovery-service.mjs";

function fail(message) { console.error(`Ошибка: ${message}`); process.exitCode = 1; }
function userArgument(argv) { if (!argv.length) return null; if (argv.length !== 2 || argv[0] !== "--user") throw new Error("Разрешён только аргумент --user с точным именем, email или ID; пароль нельзя передавать в командной строке"); const value = argv[1]; if (!value || value.startsWith("--")) throw new Error("После --user укажите точное имя, email или ID"); return value; }

async function readSecret(prompt) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") throw new Error("Для безопасного ввода пароля запустите команду с docker exec -it");
  stdout.write(prompt); emitKeypressEvents(stdin); stdin.setRawMode(true); stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => { stdin.off("keypress", keypress); stdin.setRawMode(false); stdin.pause(); stdout.write("\n"); };
    const keypress = (character, key) => {
      if (key?.ctrl && key.name === "c") { cleanup(); reject(new Error("Операция отменена")); return; }
      if (key?.name === "return" || key?.name === "enter") { cleanup(); resolve(value); return; }
      if (key?.name === "backspace") { value = value.slice(0, -1); return; }
      if (character && !key?.ctrl && !key?.meta && value.length < 128) value += character;
    };
    stdin.on("keypress", keypress);
  });
}

async function chooseUser(rl, users, requested) {
  if (requested) {
    const matches = users.filter((user) => user.id === requested || user.email.toLowerCase() === requested.toLowerCase() || user.name.toLowerCase() === requested.toLowerCase());
    if (matches.length !== 1) throw new Error(matches.length ? "Указанный пользователь неоднозначен" : "Указанный пользователь не найден");
    return matches[0];
  }
  if (users.length === 1) return users[0];
  stdout.write("\nПользователи:\n"); users.forEach((user, index) => stdout.write(`${index + 1}. ${user.name} (${user.email})\n`));
  const answer = (await rl.question("Выберите пользователя (0 — отмена): ")).trim();
  if (answer === "0") return null;
  const index = Number(answer) - 1;
  if (!Number.isInteger(index) || !users[index]) throw new Error("Некорректный выбор пользователя");
  return users[index];
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL не задан");
  const db = createRecoveryDatabase(process.env.DATABASE_URL);
  let rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write("Notebook administrator recovery\n");
    const users = await db.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, totpEnabledAt: true } });
    if (!users.length) throw new Error("Администратор ещё не создан");
    const user = await chooseUser(rl, users, userArgument(process.argv.slice(2)));
    if (!user) { stdout.write("Отменено.\n"); return; }
    stdout.write(`\nAdmin:\n${user.name} (${user.email})\n\nВыберите действие:\n\n1. Сбросить пароль\n2. Отключить TOTP 2FA\n3. Сбросить пароль и отключить TOTP 2FA\n0. Отмена\n\n`);
    const action = (await rl.question("Действие: ")).trim();
    if (action === "0") { stdout.write("Отменено.\n"); return; }
    if (!["1", "2", "3"].includes(action)) throw new Error("Некорректное действие");
    const resetPassword = action === "1" || action === "3"; const disableTotp = action === "2" || action === "3";
    let newPassword;
    if (resetPassword) {
      rl.close(); newPassword = await readSecret("Новый пароль: "); const confirmation = await readSecret("Подтверждение пароля: "); rl = createInterface({ input: stdin, output: stdout });
      if (newPassword !== confirmation) throw new Error("Пароли не совпадают");
      if (newPassword.length < 8 || newPassword.length > 128) throw new Error("Пароль должен содержать от 8 до 128 символов");
    }
    stdout.write(`\nБудут изменены параметры входа для ${user.name}. Все активные сеансы и незавершённые 2FA-проверки будут отозваны. Данные блокнотов и страниц не изменяются.\n`);
    if ((await rl.question('Введите RESET для подтверждения: ')).trim() !== "RESET") { stdout.write("Отменено.\n"); return; }
    await recoverAdministrator(db, user.id, { resetPassword, disableTotp, newPassword });
    stdout.write("\nВосстановление завершено. Все сеансы отозваны.\n");
  } finally { rl.close(); await db.$disconnect(); }
}

main().catch((error) => fail(error instanceof Error ? error.message : "Неизвестная ошибка"));
