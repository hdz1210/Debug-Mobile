import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const candidates =
  process.platform === "win32"
    ? [join(projectRoot, ".venv", "Scripts", "python.exe"), "python"]
    : [join(projectRoot, ".venv", "bin", "python"), "python3", "python"];

const python =
  candidates.find((candidate) => candidate === "python" || candidate === "python3" || existsSync(candidate)) ??
  candidates.at(-1);

const result = spawnSync(python, process.argv.slice(2), {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
