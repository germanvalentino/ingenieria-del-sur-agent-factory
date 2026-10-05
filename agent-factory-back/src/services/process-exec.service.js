import { execFile } from "node:child_process";

const FALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

// Allowlist mínima de variables de entorno del SO necesarias para que
// `npm install` funcione en Windows. Deliberadamente NO se hereda todo
// `process.env`: eso filtraría secretos de Agent Factory (SCAFFOLD_PG_*,
// credenciales, tokens, etc.) hacia npm y hacia cualquier script de
// instalación de dependencias (propias o transitivas).
const SAFE_NPM_ENV_ALLOWLIST = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "USERNAME",
  "USERPROFILE",
  "HOME",
]);

export function buildSafeNpmEnvironment(extraEnv = {}) {
  const safeEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (SAFE_NPM_ENV_ALLOWLIST.has(key.toUpperCase())) {
      safeEnv[key] = value;
    }
  }

  return { ...safeEnv, ...extraEnv };
}

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function getDefaultTimeoutMs() {
  const configured = Number(process.env.SCAFFOLD_NPM_INSTALL_TIMEOUT_MS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : FALLBACK_TIMEOUT_MS;
}

export function runNpmInstall({ cwd, timeoutMs = getDefaultTimeoutMs() }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let exitCode = null;

    const child = execFile(
      getNpmCommand(),
      ["install", "--no-audit", "--no-fund"],
      {
        cwd,
        env: buildSafeNpmEnvironment(),
        shell: false,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          success: !error && exitCode === 0,
          exitCode,
          durationMs: Date.now() - startedAt,
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          timedOut: Boolean(error?.killed && error?.signal === "SIGTERM"),
          errorMessage: error ? error.message : null,
        });
      }
    );

    child.on("exit", (code) => {
      exitCode = code;
    });
  });
}
