import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const shellEnvKeys = new Set(Object.keys(process.env));

function parseValue(rawValue: string) {
  const value = rawValue.trim();
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function applyEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || shellEnvKeys.has(key)) continue;

    const rawValue = trimmed.slice(separatorIndex + 1);
    process.env[key] = parseValue(rawValue);
  }
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const candidateRoots = [
  process.cwd(),
  resolve(currentDir, ".."),
  resolve(currentDir, "../.."),
];

for (const root of new Set(candidateRoots)) {
  applyEnvFile(resolve(root, ".env"));
  applyEnvFile(resolve(root, ".env.local"));
}
