import fs from "node:fs";
import path from "node:path";
import process from "node:process";

type ProjectConfig = {
  label: string;
  root: string;
  entry: string;
};

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");

const projects: ProjectConfig[] = [
  {
    label: "edtech",
    root: path.join(workspaceRoot, "artifacts", "edtech", "src"),
    entry: "main.tsx",
  },
  {
    label: "api-server",
    root: path.join(workspaceRoot, "artifacts", "api-server", "src"),
    entry: "index.ts",
  },
];

const localSpecPatterns = [
  /import\s+(?:[^"'()]+?\s+from\s+)?["']([^"']+)["']/g,
  /import\(\s*["']([^"']+)["']\s*\)/g,
  /export\s+\*\s+from\s+["']([^"']+)["']/g,
  /export\s+\{[^}]*\}\s+from\s+["']([^"']+)["']/g,
];

function walkFiles(dir: string, output: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, output);
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry.name)) {
      output.push(path.normalize(fullPath));
    }
  }
  return output;
}

function parseImports(source: string): string[] {
  const imports: string[] = [];
  for (const pattern of localSpecPatterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(source))) {
      imports.push(match[1]);
    }
  }
  return imports;
}

function resolveImport(fromFile: string, specifier: string, srcRoot: string): string | null {
  const candidates: string[] = [];

  if (specifier.startsWith("@/")) {
    const base = path.join(srcRoot, specifier.slice(2));
    candidates.push(base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    candidates.push(base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"));
  } else {
    return null;
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }

  return null;
}

function findUnreachableFiles({ root, entry }: ProjectConfig): string[] {
  const files = walkFiles(root);
  const fileSet = new Set(files);
  const edges = new Map<string, string[]>(files.map((file) => [file, []]));

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const specifier of parseImports(source)) {
      const resolved = resolveImport(file, specifier, root);
      if (resolved && fileSet.has(resolved)) {
        edges.get(file)?.push(resolved);
      }
    }
  }

  const entryFile = path.normalize(path.join(root, entry));
  const reachable = new Set<string>();
  const stack = [entryFile];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || reachable.has(current) || !fileSet.has(current)) continue;
    reachable.add(current);
    for (const next of edges.get(current) ?? []) {
      stack.push(next);
    }
  }

  return files.filter((file) => !reachable.has(file)).sort();
}

let hasFailures = false;

for (const project of projects) {
  const unreachable = findUnreachableFiles(project);
  if (unreachable.length === 0) {
    console.log(`${project.label}: reachable graph clean`);
    continue;
  }

  hasFailures = true;
  console.log(`${project.label}: ${unreachable.length} unreachable file(s) found`);
  for (const file of unreachable) {
    console.log(`- ${path.relative(workspaceRoot, file)}`);
  }
}

if (hasFailures) {
  process.exitCode = 1;
}
