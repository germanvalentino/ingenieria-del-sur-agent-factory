import { execFile } from "node:child_process";
import path from "node:path";
import { redactSecrets } from "./project-process-manager.service.js";

const FALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const NPM_BIN = "npm";
const WINDOWS_NPM_BIN = "npm.cmd";
const NPM_INSTALL_ARGS = ["install", "--no-audit", "--no-fund"];
const WINDOWS_CMD_ARGS = ["/d", "/s", "/c"];

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
    const normalizedKey = key.toUpperCase();
    if (
      SAFE_NPM_ENV_ALLOWLIST.has(normalizedKey) &&
      !normalizedKey.startsWith("SCAFFOLD_PG_")
    ) {
      safeEnv[key] = value;
    }
  }

  for (const [key, value] of Object.entries(extraEnv)) {
    const normalizedKey = key.toUpperCase();
    if (
      value !== undefined &&
      SAFE_NPM_ENV_ALLOWLIST.has(normalizedKey) &&
      !normalizedKey.startsWith("SCAFFOLD_PG_")
    ) {
      safeEnv[key] = value;
    }
  }

  return safeEnv;
}

function getWindowsCommandProcessor(env = process.env) {
  if (env.ComSpec || env.COMSPEC) {
    return env.ComSpec || env.COMSPEC;
  }

  const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  return path.win32.join(systemRoot, "System32", "cmd.exe");
}

function getWindowsSystemToolPath(toolName, env = process.env) {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  return path.win32.join(systemRoot, "System32", toolName);
}

export function buildNpmInstallInvocation({
  cwd,
  platform = process.platform,
  env = buildSafeNpmEnvironment(),
} = {}) {
  if (platform === "win32") {
    return {
      command: getWindowsCommandProcessor(env),
      args: [...WINDOWS_CMD_ARGS, WINDOWS_NPM_BIN, ...NPM_INSTALL_ARGS],
      options: {
        cwd,
        env,
        shell: false,
        windowsHide: true,
      },
    };
  }

  return {
    command: NPM_BIN,
    args: [...NPM_INSTALL_ARGS],
    options: {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    },
  };
}

function getDefaultTimeoutMs() {
  const configured = Number(process.env.SCAFFOLD_NPM_INSTALL_TIMEOUT_MS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : FALLBACK_TIMEOUT_MS;
}

function terminateProcessTree({ pid, platform, env, execFileImpl }) {
  if (!pid) {
    return Promise.resolve();
  }

  if (platform !== "win32") {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have already exited.
    }
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const taskkill = getWindowsSystemToolPath("taskkill.exe", env);
    const args = ["/pid", String(pid), "/t", "/f"];

    try {
      execFileImpl(
        taskkill,
        args,
        {
          env,
          shell: false,
          windowsHide: true,
        },
        () => resolve()
      );
    } catch {
      resolve();
    }
  });
}

export function runNpmInstall({
  cwd,
  timeoutMs = getDefaultTimeoutMs(),
  platform = process.platform,
  execFileImpl = execFile,
} = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let exitCode = null;
    let timedOut = false;
    let timeout = null;
    let terminationPromise = Promise.resolve();
    let settled = false;
    const invocation = buildNpmInstallInvocation({ cwd, platform });

    const child = execFileImpl(
      invocation.command,
      invocation.args,
      {
        ...invocation.options,
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        clearTimeout(timeout);
        terminationPromise.finally(() => {
          if (settled) {
            return;
          }

          settled = true;
          resolve({
            success: !error && exitCode === 0,
            exitCode,
            durationMs: Date.now() - startedAt,
            stdout: redactSecrets(stdout?.toString() ?? ""),
            stderr: redactSecrets(stderr?.toString() ?? ""),
            timedOut,
            errorMessage: error ? redactSecrets(error.message) : null,
          });
        });
      }
    );

    child.on("exit", (code) => {
      exitCode = code;
    });

    timeout = setTimeout(() => {
      timedOut = true;
      terminationPromise = terminateProcessTree({
        pid: child.pid,
        platform,
        env: invocation.options.env,
        execFileImpl,
      });
    }, timeoutMs);
  });
}
