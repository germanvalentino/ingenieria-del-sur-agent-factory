import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_EXECUTION_TIME = 15 * 60 * 1000;
const WORKTREES_ROOT = path.resolve(
  process.env.AGENT_WORKTREES_ROOT ||
    "C:/proyectos/.agent-worktrees"
);
const DEFAULT_CLAUDE_MODEL =
  process.env.CLAUDE_CODE_MODEL || "sonnet";
const CONFIGURED_CLAUDE_COMMAND =
  process.env.CLAUDE_COMMAND?.trim() || null;
const CLAUDE_ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Glob",
  "Grep",
  "LS",
  "Bash(npm:*)",
  "Bash(npm.cmd:*)",
  "Bash(node:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git ls-files:*)",
  "Bash(rg:*)",
];
const CLAUDE_DISALLOWED_TOOLS = [
  "Bash(git commit:*)",
  "Bash(git push:*)",
  "Bash(git merge:*)",
  "Bash(git checkout:*)",
  "Bash(git switch:*)",
  "Bash(npm publish:*)",
  "Bash(vercel:*)",
  "Bash(netlify:*)",
  "Bash(wrangler deploy:*)",
  "Bash(type .env*)",
  "Bash(Get-Content .env*)",
  "Bash(cat .env*)",
];
const CLAUDE_REQUIRED_HELP_OPTIONS = [
  "--model",
  "--output-format",
];
const CLAUDE_TOOL_OPTION_VARIANTS = {
  allowedTools: ["--allowed-tools", "--allowedTools"],
  disallowedTools: [
    "--disallowed-tools",
    "--disallowedTools",
  ],
};
const CLAUDE_OPTIONAL_HELP_OPTIONS = [
  "--settings",
  "--permission-mode",
];
const WINDOWS_SCRIPT_EXTENSIONS = new Set([
  ".cmd",
  ".bat",
]);
const CLAUDE_ENV_ALLOWLIST = [
  "ALLUSERSPROFILE",
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PSMODULEPATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
];
let claudeValidationPromise = null;

function redactSensitiveText(value) {
  return String(value || "")
    .replace(
      /(token|secret|password|passwd|pwd|api[_-]?key|oauth|credential|authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]"
    )
    .replace(
      /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
      "$1[REDACTED]"
    );
}

function claudeEnvironment() {
  const allowedNames = new Set(
    CLAUDE_ENV_ALLOWLIST.map((name) => name.toUpperCase())
  );

  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      allowedNames.has(name.toUpperCase())
    )
  );
}

function isInside(parent, child) {
  const relativePath = path.relative(parent, child);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") &&
      !path.isAbsolute(relativePath))
  );
}

function validateWorkingDirectory(workingDirectory) {
  if (!path.isAbsolute(workingDirectory)) {
    throw new Error("La ruta del proyecto no es absoluta");
  }

  const resolvedDirectory =
    path.resolve(workingDirectory);

  if (!fs.existsSync(resolvedDirectory)) {
    throw new Error(
      `La ruta del proyecto no existe: ${resolvedDirectory}`
    );
  }

  if (!isInside(WORKTREES_ROOT, resolvedDirectory)) {
    throw new Error(
      "Claude solamente puede trabajar dentro del worktree asignado"
    );
  }

  return resolvedDirectory;
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function resolveConfiguredCommand(commandValue) {
  const hasPathSeparator =
    commandValue.includes("/") ||
    commandValue.includes("\\");
  const configuredExtension = path
    .extname(commandValue)
    .toLowerCase();

  if (
    process.platform === "win32" &&
    WINDOWS_SCRIPT_EXTENSIONS.has(configuredExtension)
  ) {
    throw new Error(
      "CLAUDE_COMMAND debe apuntar a claude.exe en Windows; claude.cmd y claude.bat no son compatibles con spawn shell:false en este entorno."
    );
  }

  const resolvedPath = hasPathSeparator
    ? path.resolve(commandValue)
    : null;

  if (resolvedPath) {
    if (!fileExists(resolvedPath)) {
      throw new Error(
        `No se encontro el ejecutable configurado en CLAUDE_COMMAND: ${resolvedPath}`
      );
    }

    if (
      process.platform === "win32" &&
      WINDOWS_SCRIPT_EXTENSIONS.has(
        path.extname(resolvedPath).toLowerCase()
      )
    ) {
      throw new Error(
        "CLAUDE_COMMAND debe apuntar a claude.exe en Windows; claude.cmd y claude.bat no son compatibles con spawn shell:false en este entorno."
      );
    }

    return resolvedPath;
  }

  return process.platform === "win32" &&
    !configuredExtension
    ? `${commandValue}.exe`
    : commandValue;
}

function resolveClaudeCommand() {
  const commandPath = CONFIGURED_CLAUDE_COMMAND
    ? resolveConfiguredCommand(CONFIGURED_CLAUDE_COMMAND)
    : process.platform === "win32"
      ? "claude.exe"
      : "claude";

  return {
    command: commandPath,
    displayCommand: commandPath,
  };
}

function spawnClaudeProcess(
  commandConfig,
  args,
  options
) {
  return spawn(
    commandConfig.command,
    args,
    {
      ...options,
      shell: false,
      windowsHide: true,
    }
  );
}

function runClaudeDiagnostic(
  commandConfig,
  args,
  workingDirectory
) {
  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawnClaudeProcess(
        commandConfig,
        args,
        {
          cwd: workingDirectory,
          env: claudeEnvironment(),
        }
      );
    } catch (error) {
      reject(
        new Error(
          `No se pudo ejecutar ${commandConfig.displayCommand} ${args.join(" ")}: ${error.message}`
        )
      );
      return;
    }

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          "Claude no respondio al diagnostico en 15 segundos"
        )
      );
    }, 15 * 1000);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `No se pudo ejecutar ${commandConfig.displayCommand} ${args.join(" ")}: ${error.message}`
        )
      );
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

async function getClaudeHelp(
  commandConfig,
  workingDirectory
) {
  const result = await runClaudeDiagnostic(
    commandConfig,
    ["--help"],
    workingDirectory
  );

  if (result.code !== 0 || result.signal) {
    throw new Error(
      [
        `No se pudo validar claude --help para ${commandConfig.displayCommand}`,
        result.signal
          ? `Proceso cancelado por senal ${result.signal}`
          : null,
        result.code !== 0
          ? `Codigo de salida: ${result.code}`
          : null,
        redactSensitiveText(result.stderr),
        redactSensitiveText(result.stdout).slice(-4000),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return `${result.stdout}\n${result.stderr}`;
}

async function getClaudeVersion(
  commandConfig,
  workingDirectory
) {
  const result = await runClaudeDiagnostic(
    commandConfig,
    ["--version"],
    workingDirectory
  );

  if (result.code !== 0 || result.signal) {
    throw new Error(
      [
        `No se pudo validar claude --version para ${commandConfig.displayCommand}`,
        result.signal
          ? `Proceso cancelado por senal ${result.signal}`
          : null,
        result.code !== 0
          ? `Codigo de salida: ${result.code}`
          : null,
        redactSensitiveText(result.stderr),
        redactSensitiveText(result.stdout).slice(-4000),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return `${result.stdout}\n${result.stderr}`.trim();
}

function validateClaudeHelpOptions(helpOutput) {
  const missingOptions =
    CLAUDE_REQUIRED_HELP_OPTIONS.filter(
      (option) => !helpOutput.includes(option)
    );
  const allowedToolsFlag =
    CLAUDE_TOOL_OPTION_VARIANTS.allowedTools.find(
      (option) => helpOutput.includes(option)
    );
  const disallowedToolsFlag =
    CLAUDE_TOOL_OPTION_VARIANTS.disallowedTools.find(
      (option) => helpOutput.includes(option)
    );

  if (!allowedToolsFlag) {
    missingOptions.push(
      CLAUDE_TOOL_OPTION_VARIANTS.allowedTools.join(" o ")
    );
  }

  if (!disallowedToolsFlag) {
    missingOptions.push(
      CLAUDE_TOOL_OPTION_VARIANTS.disallowedTools.join(" o ")
    );
  }

  if (missingOptions.length > 0) {
    throw new Error(
      `La version instalada de Claude Code no expone las opciones requeridas: ${missingOptions.join(", ")}`
    );
  }

  if (!helpOutput.includes("--settings")) {
    throw new Error(
      "La version instalada de Claude Code no expone --settings. Agent Factory requiere --settings para aplicar las restricciones previstas; no se continuara sin esa configuracion."
    );
  }

  return {
    optionalOptions: new Set(
      CLAUDE_OPTIONAL_HELP_OPTIONS.filter((option) =>
        helpOutput.includes(option)
      )
    ),
    allowedToolsFlag,
    disallowedToolsFlag,
  };
}

export async function validateClaudeInstallation(
  workingDirectory
) {
  const resolvedDirectory =
    validateWorkingDirectory(workingDirectory);
  const commandConfig = resolveClaudeCommand();

  if (!claudeValidationPromise) {
    claudeValidationPromise = (async () => {
      await getClaudeVersion(
        commandConfig,
        resolvedDirectory
      );
      const helpOutput = await getClaudeHelp(
        commandConfig,
        resolvedDirectory
      );

      return validateClaudeHelpOptions(helpOutput);
    })().catch((error) => {
      claudeValidationPromise = null;
      throw error;
    });
  }

  return claudeValidationPromise;
}

function createClaudeSandboxSettings(
  workingDirectory,
  sandbox = "workspace-write"
) {
  const nativeWindows = process.platform === "win32";
  const readOnly = sandbox === "read-only";

  // Riesgo pendiente: Windows nativo no ofrece sandbox estricto equivalente a WSL2.
  const settingsDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-factory-claude-")
  );
  const settingsPath = path.join(
    settingsDirectory,
    "settings.json"
  );

  fs.writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        sandbox: {
          enabled: !nativeWindows,
          failIfUnavailable: !nativeWindows,
          autoAllowBashIfSandboxed: !nativeWindows,
          filesystem: {
            strictAllowlist: true,
            allowRead: [workingDirectory],
            allowWrite: readOnly
              ? []
              : [workingDirectory],
            denyRead: [
              path.join(workingDirectory, ".env"),
              path.join(workingDirectory, ".env.*"),
            ],
          },
        },
      },
      null,
      2
    )
  );

  return {
    settingsDirectory,
    settingsPath,
  };
}

function removeClaudeSandboxSettings(settingsDirectory) {
  if (!settingsDirectory) {
    return;
  }

  fs.rm(
    settingsDirectory,
    {
      recursive: true,
      force: true,
    },
    () => {}
  );
}

function numberOrZero(value) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue)
    ? numberValue
    : 0;
}

function numberOrNull(value) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue)
    ? numberValue
    : null;
}

function canonicalClaudeModel(requestedModel) {
  if (requestedModel === "sonnet") {
    return "claude-sonnet-5";
  }

  return requestedModel || DEFAULT_CLAUDE_MODEL;
}

function pickModelFromUsage({
  requestedModel,
  modelUsage,
}) {
  const requestedCanonical =
    canonicalClaudeModel(requestedModel);

  if (!modelUsage || typeof modelUsage !== "object") {
    return requestedCanonical;
  }

  for (const [modelKey, detail] of Object.entries(
    modelUsage
  )) {
    const canonicalModel =
      detail?.canonicalModel ||
      detail?.canonical_model ||
      modelKey;

    if (
      modelKey === requestedModel ||
      modelKey === requestedCanonical ||
      canonicalModel === requestedCanonical
    ) {
      return requestedCanonical;
    }
  }

  return requestedCanonical;
}

function normalizeClaudeResult({
  payload,
  requestedModel,
}) {
  const usage =
    payload?.usage &&
    typeof payload.usage === "object"
      ? payload.usage
      : {};
  const inputTokens =
    numberOrZero(usage.input_tokens) +
    numberOrZero(
      usage.cache_creation_input_tokens
    ) +
    numberOrZero(usage.cache_read_input_tokens);
  const outputTokens = numberOrNull(
    usage.output_tokens
  );
  const totalTokens =
    outputTokens === null
      ? null
      : inputTokens + outputTokens;

  return {
    exitCode: 0,
    output:
      typeof payload.result === "string"
        ? payload.result
        : JSON.stringify(payload.result ?? payload),
    usage: {
      inputTokens,
      cachedInputTokens: numberOrNull(
        usage.cache_read_input_tokens
      ),
      cacheCreationInputTokens: numberOrNull(
        usage.cache_creation_input_tokens
      ),
      outputTokens,
      totalTokens,
    },
    model: pickModelFromUsage({
      requestedModel,
      modelUsage: payload.modelUsage,
    }),
    costUsd: numberOrNull(payload.total_cost_usd),
    durationMs: numberOrNull(payload.duration_ms),
    modelUsage:
      payload.modelUsage &&
      typeof payload.modelUsage === "object"
        ? payload.modelUsage
        : null,
    permissionDenials: Array.isArray(
      payload.permission_denials
    )
      ? payload.permission_denials.map(redactSensitiveText)
      : null,
  };
}

function parseClaudeJsonOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function detectAuthError(stderr, stdout) {
  const output = `${stderr}\n${stdout}`;

  return /\b(auth|authentication|login|oauth|not\s+logged\s+in|unauthorized)\b/i.test(
    output
  );
}

function classifyClaudeProviderFailure(message) {
  const text = String(message || "");

  if (
    /\b(timeout|timed?\s*out|etimedout|tiempo\s+maximo|supero\s+el\s+tiempo|no\s+respondio)\b/i.test(
      text
    )
  ) {
    return "timeout";
  }

  if (
    /\b(rate\s*limit|rate.?limited|quota|cuota|too\s+many\s+requests|429)\b/i.test(
      text
    )
  ) {
    return "rate limit o cuota";
  }

  if (
    /\b(http\s+(?:status\s+)?5\d\d|status\s+5\d\d|5\d\d\s+(?:internal\s+server\s+error|bad\s+gateway|gateway\s+timeout|service\s+unavailable)|internal\s+server\s+error|bad\s+gateway|gateway\s+timeout)\b/i.test(
      text
    )
  ) {
    return "error 5xx del proveedor";
  }

  if (
    /\b(service\s+unavailable|temporarily\s+unavailable|overloaded|econnreset|enotfound)\b/i.test(
      text
    )
  ) {
    return "servicio no disponible";
  }

  if (
    /\b(authentication|unauthorized|login|oauth|not\s+logged\s+in|api[_-]?key|401)\b/i.test(
      text
    )
  ) {
    return "error de autenticacion";
  }

  if (
    /\b(no\s+se\s+pudo\s+ejecutar\s+claude|command\s+not\s+found:\s*claude|claude(?:\.exe)?\s+.*(?:not\s+recognized|no\s+se\s+reconoce|no\s+se\s+encontro)|spawn\s+claude(?:\.exe)?\s+enoent)\b/i.test(
      text
    )
  ) {
    return "CLI no disponible";
  }

  return null;
}

function createExecutionError(
  message,
  agentResult = null,
  providerFailureReason = null
) {
  const error = new Error(message);
  error.agentResult = agentResult;
  if (providerFailureReason) {
    error.isProviderFailure = true;
    error.providerFailureReason =
      providerFailureReason;
  }
  return error;
}

export function getClaudeDefaultModel() {
  return DEFAULT_CLAUDE_MODEL;
}

export async function executeClaude({
  workingDirectory,
  prompt,
  sandbox = "workspace-write",
  model = DEFAULT_CLAUDE_MODEL,
}) {
  const resolvedDirectory =
    validateWorkingDirectory(workingDirectory);
  let supportedOptions;

  try {
    supportedOptions =
      await validateClaudeInstallation(resolvedDirectory);
  } catch (error) {
    throw createExecutionError(
      error.message,
      null,
      classifyClaudeProviderFailure(
        error.message
      ) || "CLI no disponible"
    );
  }
  const commandConfig = resolveClaudeCommand();

  let sandboxSettings;

  sandboxSettings =
    createClaudeSandboxSettings(
      resolvedDirectory,
      sandbox
    );

  const claudeArgs = [
    "-p",
    prompt,
    "--model",
    model,
    "--output-format",
    "json",
  ];

  claudeArgs.push(
    "--settings",
    sandboxSettings.settingsPath
  );

  if (
    supportedOptions.optionalOptions.has(
      "--permission-mode"
    )
  ) {
    claudeArgs.push("--permission-mode", "default");
  }

  const allowedTools =
    sandbox === "read-only"
      ? CLAUDE_ALLOWED_TOOLS.filter(
          (tool) =>
            !["Write", "Edit", "MultiEdit"].includes(
              tool
            )
        )
      : CLAUDE_ALLOWED_TOOLS;

  claudeArgs.push(
    supportedOptions.allowedToolsFlag,
    allowedTools.join(","),
    supportedOptions.disallowedToolsFlag,
    CLAUDE_DISALLOWED_TOOLS.join(",")
  );

  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawnClaudeProcess(
        commandConfig,
        claudeArgs,
        {
          cwd: resolvedDirectory,
          env: claudeEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
    } catch (error) {
      removeClaudeSandboxSettings(
        sandboxSettings.settingsDirectory
      );
      reject(
        createExecutionError(
          error.message,
          null,
          classifyClaudeProviderFailure(
            error.message
          ) || "CLI no disponible"
        )
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    function fail(error) {
      if (settled) {
        return;
      }

      settled = true;
      removeClaudeSandboxSettings(
        sandboxSettings.settingsDirectory
      );
      reject(error);
    }

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      fail(
        createExecutionError(
          error.message,
          null,
          error.code === "ENOENT"
            ? "CLI no disponible"
            : classifyClaudeProviderFailure(
                error.message
              ) || "servicio no disponible"
        )
      );
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, MAX_EXECUTION_TIME);

    child.on("close", (code, signal) => {
      clearTimeout(timeout);

      if (settled) {
        return;
      }

      const parsedOutput =
        parseClaudeJsonOutput(stdout.trim());
      const safeStderr = redactSensitiveText(stderr);

      if (!parsedOutput) {
        const errorMessage = [
          timedOut
            ? "Claude supero el tiempo maximo de 15 minutos"
            : null,
          "Claude devolvio JSON invalido",
          safeStderr,
          redactSensitiveText(stdout).slice(-4000),
        ]
          .filter(Boolean)
          .join("\n");

        fail(
          createExecutionError(
            errorMessage,
            null,
            timedOut
              ? "timeout"
              : classifyClaudeProviderFailure(
                  `${safeStderr}\n${stdout}`
                )
          )
        );
        return;
      }

      const result = normalizeClaudeResult({
        payload: parsedOutput,
        requestedModel: model,
      });

      const failedByPayload =
        parsedOutput.is_error === true ||
        (parsedOutput.terminal_reason &&
          parsedOutput.terminal_reason !==
            "completed");

      if (
        timedOut ||
        code !== 0 ||
        signal ||
        failedByPayload
      ) {
        const authMessage = detectAuthError(
          stderr,
          stdout
        )
          ? "Claude no esta autenticado o la sesion OAuth local no esta disponible para este proceso."
          : null;
        const errorMessage = [
          authMessage,
          redactSensitiveText(result.output),
          safeStderr,
          timedOut
            ? "Claude supero el tiempo maximo de 15 minutos"
            : null,
          signal
            ? `Claude fue cancelado por senal ${signal}`
            : null,
          code !== 0
            ? `Claude finalizo con codigo ${code}`
            : null,
          failedByPayload
            ? `Claude finalizo con terminal_reason=${parsedOutput.terminal_reason}`
            : null,
        ]
          .filter(Boolean)
          .join("\n");
        const providerFailureReason =
          timedOut
            ? "timeout"
            : authMessage
              ? "error de autenticacion"
              : classifyClaudeProviderFailure(
                  `${safeStderr}\n${result.output}`
                );

        fail(
          createExecutionError(
            errorMessage,
            result,
            providerFailureReason
          )
        );
        return;
      }

      settled = true;
      removeClaudeSandboxSettings(
        sandboxSettings.settingsDirectory
      );
      resolve(result);
    });
  });
}
