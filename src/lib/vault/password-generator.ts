export type PasswordGeneratorOptions = { length: number; uppercase: boolean; lowercase: boolean; digits: boolean; symbols: boolean; avoidAmbiguous?: boolean };

const SETS = { uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", lowercase: "abcdefghijklmnopqrstuvwxyz", digits: "0123456789", symbols: "!@#$%^&*()-_=+[]{};:,.?" } as const;
const AMBIGUOUS = new Set("Il1O0o|`'\"".split(""));

function randomIndex(limit: number, cryptoApi: Crypto) {
  const ceiling = Math.floor(256 / limit) * limit;
  const byte = new Uint8Array(1);
  do cryptoApi.getRandomValues(byte); while (byte[0]! >= ceiling);
  return byte[0]! % limit;
}

export function generatePassword(options: PasswordGeneratorOptions, cryptoApi: Crypto = globalThis.crypto): string {
  if (!Number.isInteger(options.length) || options.length < 8 || options.length > 256) throw new Error("Длина пароля должна быть от 8 до 256 символов");
  const enabled = (Object.keys(SETS) as Array<keyof typeof SETS>).filter((key) => options[key]);
  if (enabled.length === 0) throw new Error("Выберите хотя бы один набор символов");
  const sets = enabled.map((key) => [...SETS[key]].filter((char) => !options.avoidAmbiguous || !AMBIGUOUS.has(char)).join(""));
  const required = sets.map((set) => set[randomIndex(set.length, cryptoApi)]!);
  const alphabet = sets.join("");
  const result = [...required];
  while (result.length < options.length) result.push(alphabet[randomIndex(alphabet.length, cryptoApi)]!);
  for (let index = result.length - 1; index > 0; index--) { const target = randomIndex(index + 1, cryptoApi); [result[index], result[target]] = [result[target]!, result[index]!]; }
  return result.join("");
}

export function estimatePasswordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  const entropyProxy = password.length * Math.max(classes, 1);
  if (entropyProxy < 24) return 1;
  if (entropyProxy < 40) return 2;
  if (entropyProxy < 64) return 3;
  return 4;
}
