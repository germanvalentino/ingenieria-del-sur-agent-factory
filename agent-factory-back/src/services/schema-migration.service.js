import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redactSecrets } from "./secret-redaction.service.js";

// Migraciones internas explicitas e idempotentes. No se recorre database/
// ni se vuelven a ejecutar las migraciones historicas de la instalacion.
const MIGRATION_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "database",
  "015-project-launch.sql"
);

export class SchemaMigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaMigrationError";
  }
}

async function resolveDb(db) {
  if (db) {
    return db;
  }

  const module = await import("../db.js");
  return module.pool;
}

export async function ensureProjectLaunchSchema({ db = null } = {}) {
  const resolvedDb = await resolveDb(db);
  let sql;

  try {
    sql = await fs.readFile(MIGRATION_PATH, "utf8");
  } catch {
    throw new SchemaMigrationError(
      "No se pudo leer la migración interna del esquema de lanzamiento de proyectos."
    );
  }

  try {
    await resolvedDb.query(sql);
    await resolvedDb.query(await fs.readFile(path.join(path.dirname(MIGRATION_PATH), "016-qa-cycle.sql"), "utf8"));
  } catch (error) {
    const sanitized = redactSecrets(error?.message || "error desconocido");

    throw new SchemaMigrationError(
      `No se pudo aplicar la migración interna del esquema de lanzamiento de proyectos: ${sanitized}`
    );
  }
}
