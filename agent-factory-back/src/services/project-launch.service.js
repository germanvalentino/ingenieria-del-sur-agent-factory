import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { pool } from "../db.js";
import {
  createProjectFromScratch,
  rollbackScaffoldedProject,
} from "./project-scaffold.service.js";
import {
  toDatabaseIdentifier,
  assertValidDatabaseIdentifier,
} from "./db-identifier.service.js";
import {
  databaseExists,
  createDatabase,
  dropDatabase,
  runSqlFile,
  getScaffoldPgCredentials,
} from "./postgres-provision.service.js";
import { runNpmInstall } from "./process-exec.service.js";
import { findFreePort } from "./port-finder.service.js";
import {
  startBackendProcess,
  startFrontendProcess,
  stopProcess,
  redactSecrets,
} from "./project-process-manager.service.js";

const execFileAsync = promisify(execFile);
const DEFAULT_LAUNCH_DEPS = {
  createProjectFromScratch,
  rollbackScaffoldedProject,
  databaseExists,
  createDatabase,
  dropDatabase,
  runSqlFile,
  getScaffoldPgCredentials,
  runNpmInstall,
  findFreePort,
  startBackendProcess,
  startFrontendProcess,
  stopProcess,
  pool,
  execFileAsync,
};

export const STAGE_NAMES = [
  "Generando estructura",
  "Inicializando Git",
  "Creando base PostgreSQL",
  "Instalando backend",
  "Instalando frontend",
  "Aplicando migraciones",
  "Iniciando backend",
  "Iniciando frontend",
  "Comprobando servicios",
];

export class ExistingDatabaseError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ExistingDatabaseError";
    this.code = "EXISTING_DATABASE";
    this.details = details;
  }
}

function noopStage() {}

function isValidBranchName(branchName) {
  return (
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(branchName) &&
    !branchName.includes("..") &&
    !branchName.endsWith("/") &&
    !branchName.endsWith(".")
  );
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureGitInitialized(
  projectPath,
  defaultBranch,
  execFileRunner = execFileAsync
) {
  const gitDir = path.join(projectPath, ".git");

  if (await pathExists(gitDir)) {
    return { initialized: false };
  }

  await execFileRunner("git", ["init"], {
    cwd: projectPath,
    windowsHide: true,
  });

  if (isValidBranchName(defaultBranch)) {
    await execFileRunner(
      "git",
      ["symbolic-ref", "HEAD", `refs/heads/${defaultBranch}`],
      { cwd: projectPath, windowsHide: true }
    );
  }

  return { initialized: true };
}

async function writeBackendEnvFile({
  backendPath,
  port,
  dbName,
  getCredentials = getScaffoldPgCredentials,
}) {
  const credentials = getCredentials();
  const envPath = path.join(backendPath, ".env");

  const content = [
    `PORT=${port}`,
    `PGHOST=${credentials.host}`,
    `PGPORT=${credentials.port}`,
    `PGUSER=${credentials.user}`,
    `PGPASSWORD=${credentials.password}`,
    `PGDATABASE=${dbName}`,
    "",
  ].join("\n");

  await fs.writeFile(envPath, content, "utf8");
}

async function waitFor(fn, { attempts = 20, intervalMs = 500 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError || new Error("La comprobación no se completó a tiempo");
}

async function checkJsonHealth(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || !contentType.includes("application/json")) {
    throw new Error(`Respuesta inválida de ${url}`);
  }

  return response.json();
}

async function checkReachable(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

  if (!response.ok) {
    throw new Error(`Respuesta inválida de ${url}`);
  }
}

async function insertProjectRow({
  name,
  description,
  frontendPath,
  backendPath,
  repositoryUrl,
  defaultBranch,
  dbPool = pool,
}) {
  const result = await dbPool.query(
    `
      INSERT INTO projects (
        name, description, frontend_path, backend_path,
        repository_url, default_branch, active
      )
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      RETURNING *
    `,
    [name, description, frontendPath, backendPath, repositoryUrl, defaultBranch]
  );

  return result.rows[0];
}

export async function runProjectCreateAndStart({
  name,
  description,
  projectPath,
  repositoryUrl,
  defaultBranch = "main",
  onStage = noopStage,
  __deps = {},
}) {
  const deps = { ...DEFAULT_LAUNCH_DEPS, ...__deps };
  let created = null;
  let project = null;
  let dbName = null;
  let dbCreatedByUs = false;
  let backendStarted = false;
  let frontendStarted = false;
  let backendPort = null;
  let frontendPort = null;

  async function rollbackEverything() {
    const warnings = [];

    if (backendStarted && project) {
      await deps.stopProcess(project.id, "backend").catch((error) =>
        warnings.push(error.message)
      );
    }

    if (frontendStarted && project) {
      await deps.stopProcess(project.id, "frontend").catch((error) =>
        warnings.push(error.message)
      );
    }

    if (dbCreatedByUs && dbName) {
      await deps.dropDatabase(dbName).catch((error) => warnings.push(error.message));
    }

    if (project) {
      await deps.pool
        .query("DELETE FROM projects WHERE id = $1", [project.id])
        .catch((error) => warnings.push(error.message));
    }

    if (created) {
      await deps.rollbackScaffoldedProject(created).catch((error) =>
        warnings.push(error.cleanupWarning || error.message)
      );
    }

    return warnings;
  }

  try {
    // Etapa 1: Generando estructura
    onStage("Generando estructura", "running");

    try {
      created = await deps.createProjectFromScratch({ name, projectPath });

      try {
        project = await insertProjectRow({
          name,
          description,
          frontendPath: created.frontendPath,
          backendPath: created.backendPath,
          repositoryUrl,
          defaultBranch,
          dbPool: deps.pool,
        });
      } catch (dbError) {
        await deps.rollbackScaffoldedProject(created).catch((rollbackError) => {
          dbError.cleanupWarning =
            rollbackError.cleanupWarning || rollbackError.message;
        });

        created = null;
        throw dbError;
      }

      onStage("Generando estructura", "completed");
    } catch (error) {
      onStage("Generando estructura", "failed", error.message);
      throw error;
    }

    // Etapa 2: Inicializando Git
    onStage("Inicializando Git", "running");

    try {
      await ensureGitInitialized(
        created.projectPath,
        defaultBranch,
        deps.execFileAsync
      );
      onStage("Inicializando Git", "completed");
    } catch (error) {
      onStage("Inicializando Git", "failed", error.message);
      throw error;
    }

    // Etapa 3: Creando base PostgreSQL
    onStage("Creando base PostgreSQL", "running");

    try {
      dbName = assertValidDatabaseIdentifier(toDatabaseIdentifier(name));

      if (await deps.databaseExists(dbName)) {
        throw new ExistingDatabaseError(
          `La base de datos "${dbName}" ya existe: no se modifica ni se recrea.`,
          { dbName }
        );
      }

      await deps.createDatabase(dbName);
      dbCreatedByUs = true;

      await deps.pool.query(
        `UPDATE projects
         SET scaffold_db_name = $2, scaffold_db_created_by_tool = TRUE, updated_at = NOW()
         WHERE id = $1`,
        [project.id, dbName]
      );

      backendPort = await deps.findFreePort(
        Number(process.env.SCAFFOLD_BACKEND_PORT_START)
      );

      await writeBackendEnvFile({
        backendPath: created.backendPath,
        port: backendPort,
        dbName,
        getCredentials: deps.getScaffoldPgCredentials,
      });

      onStage("Creando base PostgreSQL", "completed");
    } catch (error) {
      onStage("Creando base PostgreSQL", "failed", error.message);
      throw error;
    }

    // Etapa 4: Instalando backend
    onStage("Instalando backend", "running");

    try {
      const result = await deps.runNpmInstall({ cwd: created.backendPath });

      if (!result.success) {
        const detail = redactSecrets(
          result.errorMessage || result.stderr.slice(-500)
        );
        throw new Error(`Falló "npm install" en backend: ${detail}`);
      }

      onStage("Instalando backend", "completed");
    } catch (error) {
      onStage("Instalando backend", "failed", error.message);
      throw error;
    }

    // Etapa 5: Instalando frontend
    onStage("Instalando frontend", "running");

    try {
      const result = await deps.runNpmInstall({ cwd: created.frontendPath });

      if (!result.success) {
        const detail = redactSecrets(
          result.errorMessage || result.stderr.slice(-500)
        );
        throw new Error(`Falló "npm install" en frontend: ${detail}`);
      }

      onStage("Instalando frontend", "completed");
    } catch (error) {
      onStage("Instalando frontend", "failed", error.message);
      throw error;
    }

    // Etapa 6: Aplicando migraciones
    onStage("Aplicando migraciones", "running");

    try {
      await deps.runSqlFile(
        dbName,
        path.join(created.backendPath, "database", "001-init.sql")
      );
      onStage("Aplicando migraciones", "completed");
    } catch (error) {
      onStage("Aplicando migraciones", "failed", error.message);
      throw error;
    }

    // Etapa 7: Iniciando backend
    onStage("Iniciando backend", "running");

    try {
      const result = await deps.startBackendProcess({
        project,
        preferredPort: backendPort,
      });

      backendStarted = true;
      backendPort = result.port || backendPort;
      onStage("Iniciando backend", "completed");
    } catch (error) {
      onStage("Iniciando backend", "failed", error.message);
      throw error;
    }

    // Etapa 8: Iniciando frontend
    onStage("Iniciando frontend", "running");

    try {
      const result = await deps.startFrontendProcess({
        project,
        backendPort,
      });

      frontendStarted = true;
      frontendPort = result.port;
      onStage("Iniciando frontend", "completed");
    } catch (error) {
      onStage("Iniciando frontend", "failed", error.message);
      throw error;
    }

    // Etapa 9: Comprobando servicios
    onStage("Comprobando servicios", "running");

    try {
      const backendUrl = `http://localhost:${backendPort}`;
      const frontendUrl = `http://localhost:${frontendPort}`;

      await waitFor(() => checkJsonHealth(`${backendUrl}/api/health`));
      await waitFor(() => checkJsonHealth(`${backendUrl}/api/db-health`));
      await waitFor(() => checkReachable(frontendUrl));

      onStage("Comprobando servicios", "completed");

      return {
        project,
        dbName,
        dbCreatedByUs,
        frontendUrl,
        backendUrl,
        frontendPort,
        backendPort,
        dependenciesInstalled: true,
        migrationsApplied: true,
      };
    } catch (error) {
      onStage("Comprobando servicios", "failed", error.message);
      throw error;
    }
  } catch (error) {
    const warnings = await rollbackEverything();

    if (warnings.length > 0) {
      error.cleanupWarning = warnings.join("; ");
    }

    throw error;
  }
}
