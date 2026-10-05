import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureProjectLaunchSchema,
  SchemaMigrationError,
} from "../schema-migration.service.js";

const MIGRATION_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "database",
  "015-project-launch.sql"
);

test("015-project-launch.sql es idempotente: usa guards IF NOT EXISTS y no borra datos existentes", async () => {
  const sql = await fs.readFile(MIGRATION_FILE, "utf8");
  const upperSql = sql.toUpperCase();

  assert.match(sql, /CREATE TABLE IF NOT EXISTS/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS/i);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS\s+\S+\s+ON\s+project_processes\s*\(\s*project_id\s*,\s*process_type\s*\)/i,
    "debe crear el índice único de (project_id, process_type) con guard IF NOT EXISTS, " +
      "para que ON CONFLICT (project_id, process_type) funcione aunque la tabla ya existiera sin esa restricción"
  );

  for (const destructive of ["DROP TABLE", "DROP COLUMN", "DELETE FROM", "TRUNCATE"]) {
    assert.ok(
      !upperSql.includes(destructive),
      `la migración 015 no debe contener "${destructive}"`
    );
  }
});

test("ensureProjectLaunchSchema aplica la migración contra el pool recibido", async () => {
  const queries = [];
  const fakeDb = {
    query: async (sql) => {
      queries.push(sql);
      return { rows: [] };
    },
  };

  await ensureProjectLaunchSchema({ db: fakeDb });

  assert.equal(queries.length, 1);
  assert.match(queries[0], /project_processes/);
});

test("ensureProjectLaunchSchema puede ejecutarse dos veces sin fallar (migración idempotente)", async () => {
  const fakeDb = {
    query: async () => ({ rows: [] }),
  };

  await ensureProjectLaunchSchema({ db: fakeDb });
  await ensureProjectLaunchSchema({ db: fakeDb });
});

test("ensureProjectLaunchSchema no expone credenciales ni connection strings en el error", async () => {
  const fakeDb = {
    query: async () => {
      throw new Error(
        "connection to server failed: postgres://scaffold_user:super-secreta@localhost:5432/postgres"
      );
    },
  };

  await assert.rejects(
    () => ensureProjectLaunchSchema({ db: fakeDb }),
    (error) => {
      assert.ok(error instanceof SchemaMigrationError);
      assert.ok(!error.message.includes("super-secreta"));
      assert.ok(error.message.includes("[REDACTED]"));
      return true;
    }
  );
});
