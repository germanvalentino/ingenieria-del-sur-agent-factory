import { spawn } from "node:child_process";
import path from "node:path";
import { pool } from "../db.js";
import { isPortFree, findFreePort } from "./port-finder.service.js";
import { redactSecrets } from "./secret-redaction.service.js";

export { redactSecrets } from "./secret-redaction.service.js";

const LOG_LIMIT = 4000;
const runningChildren = new Map();
const logBuffers = new Map();

// Allowlist de variables de entorno del SO necesarias para que Node/npm/Vite
// puedan ejecutarse en Windows. Deliberadamente NO se hereda todo
// `process.env`: eso filtraría secretos de Agent Factory (SCAFFOLD_PG_*,
// credenciales de WhatsApp, etc.) hacia los procesos de los proyectos generados.
const SAFE_ENV_ALLOWLIST = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "USERNAME",
  "USERDOMAIN",
  "HOMEDRIVE",
  "HOMEPATH",
  "COMSPEC",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
]);

function buildSafeChildEnv(extraEnv = {}) {
  const safeEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (SAFE_ENV_ALLOWLIST.has(key.toUpperCase())) {
      safeEnv[key] = value;
    }
  }

  return { ...safeEnv, ...extraEnv };
}

function entryKey(projectId, processType) {
  return `${projectId}:${processType}`;
}

function isPidRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function appendLog(key, chunk) {
  const sanitized = redactSecrets(chunk);
  const next = `${logBuffers.get(key) || ""}${sanitized}`;
  logBuffers.set(
    key,
    next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next
  );
}

async function getRow(projectId, processType) {
  const result = await pool.query(
    `SELECT * FROM project_processes WHERE project_id = $1 AND process_type = $2`,
    [projectId, processType]
  );

  return result.rows[0] || null;
}

async function upsertRow(projectId, processType, fields) {
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const setClauses = columns
    .map((column, index) => `${column} = $${index + 3}`)
    .join(", ");
  const insertColumns = ["project_id", "process_type", ...columns].join(", ");
  const insertPlaceholders = ["$1", "$2", ...columns.map((_, index) => `$${index + 3}`)].join(
    ", "
  );

  const result = await pool.query(
    `
      INSERT INTO project_processes (${insertColumns})
      VALUES (${insertPlaceholders})
      ON CONFLICT (project_id, process_type)
      DO UPDATE SET ${setClauses}, updated_at = NOW()
      RETURNING *
    `,
    [projectId, processType, ...values]
  );

  return result.rows[0];
}

async function markStoppedIfDead(row) {
  if (!row) {
    return row;
  }

  if (
    ["running", "starting"].includes(row.status) &&
    !isPidRunning(row.pid)
  ) {
    const result = await pool.query(
      `UPDATE project_processes
       SET status = 'stopped', pid = NULL, stopped_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [row.id]
    );

    return result.rows[0];
  }

  return row;
}

export async function reconcileProjectProcesses() {
  const result = await pool.query(
    `SELECT * FROM project_processes WHERE status IN ('running', 'starting')`
  );

  for (const row of result.rows) {
    await markStoppedIfDead(row);
  }
}

function spawnManaged({ projectId, processType, cwd, args, env, port, url }) {
  const key = entryKey(projectId, processType);
  logBuffers.delete(key);

  const child = spawn(process.execPath, args, {
    cwd,
    env: buildSafeChildEnv(env),
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  runningChildren.set(key, child);

  child.stdout?.on("data", (chunk) => appendLog(key, chunk.toString()));
  child.stderr?.on("data", (chunk) => appendLog(key, chunk.toString()));

  child.on("error", (error) => {
    appendLog(key, `\n[error al iniciar proceso] ${error.message}`);
  });

  child.on("exit", async (code, signal) => {
    runningChildren.delete(key);

    await pool
      .query(
        `UPDATE project_processes
         SET status = $3, pid = NULL, stopped_at = NOW(), last_log = $4, updated_at = NOW()
         WHERE project_id = $1 AND process_type = $2`,
        [
          projectId,
          processType,
          code === 0 || signal ? "stopped" : "failed",
          logBuffers.get(key) || "",
        ]
      )
      .catch(() => {});
  });

  return upsertRow(projectId, processType, {
    pid: child.pid,
    port,
    url,
    status: "running",
    started_at: new Date(),
    stopped_at: null,
    last_log: null,
  });
}

export async function startBackendProcess({ project, preferredPort = null }) {
  const existing = await markStoppedIfDead(
    await getRow(project.id, "backend")
  );

  if (existing && existing.status === "running" && isPidRunning(existing.pid)) {
    return { alreadyRunning: true, row: existing };
  }

  const startPort = Number(
    preferredPort || process.env.SCAFFOLD_BACKEND_PORT_START
  );

  if (!Number.isInteger(startPort) || startPort <= 0) {
    throw new Error(
      "SCAFFOLD_BACKEND_PORT_START no está configurado en el .env de Agent Factory"
    );
  }

  let port = preferredPort || existing?.port;

  if (!port || !(await isPortFree(port))) {
    port = await findFreePort(startPort);
  }

  const url = `http://localhost:${port}`;
  const serverEntry = path.join(project.backend_path, "src", "server.js");

  const row = await spawnManaged({
    projectId: project.id,
    processType: "backend",
    cwd: project.backend_path,
    args: [serverEntry],
    env: { PORT: String(port) },
    port,
    url,
  });

  return { alreadyRunning: false, row, port, url };
}

export async function startFrontendProcess({
  project,
  backendPort,
  preferredPort = null,
}) {
  const existing = await markStoppedIfDead(
    await getRow(project.id, "frontend")
  );

  if (existing && existing.status === "running" && isPidRunning(existing.pid)) {
    return { alreadyRunning: true, row: existing };
  }

  const startPort = Number(
    preferredPort || process.env.SCAFFOLD_FRONTEND_PORT_START
  );

  if (!Number.isInteger(startPort) || startPort <= 0) {
    throw new Error(
      "SCAFFOLD_FRONTEND_PORT_START no está configurado en el .env de Agent Factory"
    );
  }

  let port = preferredPort || existing?.port;

  if (!port || !(await isPortFree(port))) {
    port = await findFreePort(startPort);
  }

  const url = `http://localhost:${port}`;
  const viteEntry = path.join(
    project.frontend_path,
    "node_modules",
    "vite",
    "bin",
    "vite.js"
  );

  const row = await spawnManaged({
    projectId: project.id,
    processType: "frontend",
    cwd: project.frontend_path,
    args: [viteEntry],
    env: {
      PORT: String(port),
      BACKEND_PORT: String(backendPort || ""),
    },
    port,
    url,
  });

  return { alreadyRunning: false, row, port, url };
}

export async function stopProcess(projectId, processType) {
  const row = await getRow(projectId, processType);

  if (!row || !["running", "starting"].includes(row.status)) {
    return { alreadyStopped: true };
  }

  const key = entryKey(projectId, processType);
  const child = runningChildren.get(key);

  if (child) {
    child.kill();
  } else if (row.pid && isPidRunning(row.pid)) {
    try {
      process.kill(row.pid);
    } catch {
      // El proceso ya no existe.
    }
  }

  runningChildren.delete(key);

  await pool.query(
    `UPDATE project_processes
     SET status = 'stopped', pid = NULL, stopped_at = NOW(), updated_at = NOW()
     WHERE project_id = $1 AND process_type = $2`,
    [projectId, processType]
  );

  return { alreadyStopped: false };
}

export async function stopProjectProcesses(projectId) {
  await stopProcess(projectId, "backend");
  await stopProcess(projectId, "frontend");
}

export async function restartBackendProcess({ project }) {
  await stopProcess(project.id, "backend");
  return startBackendProcess({ project });
}

export async function restartFrontendProcess({ project, backendPort }) {
  await stopProcess(project.id, "frontend");
  return startFrontendProcess({ project, backendPort });
}

export async function getProjectProcessesStatus(projectId) {
  const [backendRow, frontendRow] = await Promise.all([
    markStoppedIfDead(await getRow(projectId, "backend")),
    markStoppedIfDead(await getRow(projectId, "frontend")),
  ]);

  return {
    backend: backendRow,
    frontend: frontendRow,
  };
}

export function getRecentLogs(projectId, processType) {
  return logBuffers.get(entryKey(projectId, processType)) || "";
}
