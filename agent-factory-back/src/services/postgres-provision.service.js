import fs from "node:fs/promises";
import pg from "pg";
import { assertValidDatabaseIdentifier } from "./db-identifier.service.js";

const { Client } = pg;

export class ScaffoldPgConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScaffoldPgConfigError";
    this.code = "SCAFFOLD_PG_CONFIG";
  }
}

function getScaffoldPgConfig() {
  const host = process.env.SCAFFOLD_PG_HOST;
  const port = Number(process.env.SCAFFOLD_PG_PORT || 5432);
  const user = process.env.SCAFFOLD_PG_USER;
  const password = process.env.SCAFFOLD_PG_PASSWORD;

  if (!host || !user || password === undefined || password === "") {
    throw new ScaffoldPgConfigError(
      "Faltan variables SCAFFOLD_PG_HOST, SCAFFOLD_PG_USER o SCAFFOLD_PG_PASSWORD en el .env de Agent Factory"
    );
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new ScaffoldPgConfigError("SCAFFOLD_PG_PORT inválido");
  }

  return { host, port, user, password };
}

function quoteIdentifier(identifier) {
  assertValidDatabaseIdentifier(identifier);
  return `"${identifier}"`;
}

async function withAdminClient(database, fn) {
  const config = getScaffoldPgConfig();
  const client = new Client({ ...config, database });

  await client.connect();

  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function databaseExists(databaseName) {
  assertValidDatabaseIdentifier(databaseName);

  return withAdminClient("postgres", async (client) => {
    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName]
    );

    return result.rowCount > 0;
  });
}

export async function createDatabase(databaseName) {
  assertValidDatabaseIdentifier(databaseName);

  await withAdminClient("postgres", async (client) => {
    await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  });
}

export async function dropDatabase(databaseName) {
  assertValidDatabaseIdentifier(databaseName);

  await withAdminClient("postgres", async (client) => {
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName]
    );

    await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  });
}

export async function runSqlFile(databaseName, filePath) {
  assertValidDatabaseIdentifier(databaseName);

  const sql = await fs.readFile(filePath, "utf8");

  if (!sql.trim()) {
    return;
  }

  await withAdminClient(databaseName, async (client) => {
    await client.query(sql);
  });
}

export function getScaffoldPgConnectionInfo() {
  const config = getScaffoldPgConfig();

  return { host: config.host, port: config.port, user: config.user };
}

export function getScaffoldPgCredentials() {
  return getScaffoldPgConfig();
}
