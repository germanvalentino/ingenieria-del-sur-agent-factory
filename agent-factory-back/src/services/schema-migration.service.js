import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import { redactSecrets } from "./project-process-manager.service.js";

// Ruta fija resuelta desde import.meta.url: nunca depende del cwd del
// proceso ni de un nombre de archivo recibido de afuera. Es la única
// migración que este arreglo aplica automáticamente (ver nota en el README
// de la corrección): no se recorre `database/` ni se ejecutan migraciones
// antiguas, porque una instalación existente puede ya tenerlas aplicadas.
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

export async function ensureProjectLaunchSchema({ db = pool } = {}) {
  let sql;

  try {
    sql = await fs.readFile(MIGRATION_PATH, "utf8");
  } catch {
    throw new SchemaMigrationError(
      "No se pudo leer la migración interna del esquema de lanzamiento de proyectos."
    );
  }

  try {
    await db.query(sql);
  } catch (error) {
    const sanitized = redactSecrets(error?.message || "error desconocido");

    throw new SchemaMigrationError(
      `No se pudo aplicar la migración interna del esquema de lanzamiento de proyectos: ${sanitized}`
    );
  }
}
