import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ALLOWED_ROOT = path.resolve(
  "C:/proyectos"
);

function normalizePath(directory) {
  return path
    .resolve(directory)
    .replaceAll("\\", "/");
}

function validateAllowedPath(directory) {
  const resolved = path.resolve(directory);

  if (
    resolved !== ALLOWED_ROOT &&
    !resolved.startsWith(
      `${ALLOWED_ROOT}${path.sep}`
    )
  ) {
    throw new Error(
      "La ruta debe estar dentro de C:/proyectos"
    );
  }

  return resolved;
}

export async function validateProjectPath(
  directory,
  label
) {
  if (!directory?.trim()) {
    return null;
  }

  const resolved = validateAllowedPath(
    directory.trim()
  );

  let stats;

  try {
    stats = await fs.stat(resolved);
  } catch {
    throw new Error(
      `La ruta ${label} no existe: ${directory}`
    );
  }

  if (!stats.isDirectory()) {
    throw new Error(
      `La ruta ${label} no es una carpeta`
    );
  }

  const packageJsonPath = path.join(
    resolved,
    "package.json"
  );

  try {
    await fs.access(packageJsonPath);
  } catch {
    throw new Error(
      `La ruta ${label} no contiene package.json`
    );
  }

  let repositoryRoot;

  try {
    const result = await execFileAsync(
      "git",
      [
        "rev-parse",
        "--show-toplevel",
      ],
      {
        cwd: resolved,
        windowsHide: true,
      }
    );

    repositoryRoot = normalizePath(
      result.stdout.trim()
    );
  } catch {
    throw new Error(
      `La ruta ${label} no pertenece a un repositorio Git`
    );
  }

  return {
    path: normalizePath(resolved),
    repositoryRoot,
  };
}