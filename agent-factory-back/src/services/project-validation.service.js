import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ALLOWED_ROOT = path.resolve(
  "C:/proyectos"
);

export class InvalidPathError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidPathError";
    this.code = "INVALID_PATH";
  }
}

export function normalizePath(directory) {
  return path
    .resolve(directory)
    .replaceAll("\\", "/");
}

export function validateAllowedPath(directory) {
  const resolved = path.resolve(directory);

  if (
    resolved !== ALLOWED_ROOT &&
    !resolved.startsWith(
      `${ALLOWED_ROOT}${path.sep}`
    )
  ) {
    throw new InvalidPathError(
      "La ruta debe estar dentro de C:/proyectos"
    );
  }

  return resolved;
}

/**
 * Resuelve enlaces simbólicos del ancestro existente más profundo y confirma
 * que la ubicación real sigue dentro de ALLOWED_ROOT. Evita que una ruta
 * lexicalmente válida escape del directorio permitido vía symlink.
 */
export async function assertRealPathWithinAllowedRoot(resolvedPath) {
  const realRoot = await fs.realpath(ALLOWED_ROOT).catch(() => ALLOWED_ROOT);

  let current = resolvedPath;

  while (true) {
    try {
      await fs.stat(current);
      break;
    } catch {
      const parent = path.dirname(current);

      if (parent === current) {
        break;
      }

      current = parent;
    }
  }

  const realCurrent = await fs.realpath(current).catch(() => current);

  if (
    realCurrent !== realRoot &&
    !realCurrent.startsWith(`${realRoot}${path.sep}`)
  ) {
    throw new InvalidPathError(
      "La ruta destino escapa de la carpeta de proyectos permitida"
    );
  }
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