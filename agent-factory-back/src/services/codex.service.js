import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_EXECUTION_TIME = 15 * 60 * 1000;

function createProviderFailureError(message, reason) {
  const error = new Error(message);
  error.isProviderFailure = true;
  error.providerFailureReason = reason;
  return error;
}

function classifyCodexProviderFailure(message) {
  const text = String(message || "");

  if (
    /\b(timeout|timed?\s*out|etimedout|tiempo\s+m[aá]ximo|super[oó]\s+el\s+tiempo)\b/i.test(
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
    /\b(command\s+not\s+found:\s*codex|codex(?:\.exe)?\s+.*(?:not\s+recognized|no\s+se\s+reconoce|no\s+se\s+encontro)|spawn\s+codex(?:\.exe)?\s+enoent)\b/i.test(
      text
    )
  ) {
    return "CLI no disponible";
  }

  return null;
}

function toNumberOrNull(value) {
  if (Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    const normalized = toNumberOrNull(value);

    if (normalized !== null) {
      return normalized;
    }
  }

  return null;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const inputTokens = firstNumber(
    usage.input_tokens,
    usage.inputTokens,
    usage.prompt_tokens,
    usage.promptTokens
  );
  const cachedInputTokens = firstNumber(
    usage.cached_input_tokens,
    usage.cachedInputTokens,
    usage.input_tokens_details
      ?.cached_tokens,
    usage.input_tokens_details
      ?.cached_input_tokens,
    usage.inputTokensDetails
      ?.cachedTokens,
    usage.prompt_tokens_details
      ?.cached_tokens,
    usage.promptTokensDetails
      ?.cachedTokens
  );
  const outputTokens = firstNumber(
    usage.output_tokens,
    usage.outputTokens,
    usage.completion_tokens,
    usage.completionTokens
  );
  const totalTokens = firstNumber(
    usage.total_tokens,
    usage.totalTokens
  );

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens:
      totalTokens ??
      (inputTokens !== null &&
      outputTokens !== null
        ? inputTokens + outputTokens
        : null),
  };
}

function parseCodexJsonOutput(output) {
  const events = [];
  const agentMessages = [];
  let usage = null;
  let model = null;
  let streamError = null;

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed);
      events.push(event);
      model =
        event.model ??
        event.provider_model ??
        event.providerModel ??
        event.turn?.model ??
        event.response?.model ??
        event.item?.model ??
        model;

      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        typeof event.item.text === "string"
      ) {
        agentMessages.push(event.item.text);
      }

      const eventUsage =
        event.usage ??
        event.turn?.usage ??
        event.response?.usage ??
        event.item?.usage ??
        null;

      if (eventUsage) {
        const normalized = normalizeUsage(eventUsage);
        if (normalized) {
          usage = normalized;
        }
      }

      if (
        event.type === "error" ||
        event.type === "turn.failed"
      ) {
        streamError =
          event.message ??
          event.error?.message ??
          streamError;
      }
    } catch {
      // Codex puede escribir alguna linea informativa junto al JSONL.
      // La ignoramos y conservamos los eventos JSON validos.
      continue;
    }
  }

  if (events.length === 0) {
    return null;
  }

  return {
    output:
      agentMessages.at(-1)?.trim() ||
      output.trim(),
    usage,
    model,
    streamError,
  };
}

export function executeCodex({
  workingDirectory,
  prompt,
  sandbox = "workspace-write",
  model = null,
})  {
  return new Promise((resolve, reject) => {
    if (!path.isAbsolute(workingDirectory)) {
      reject(new Error("La ruta del proyecto no es absoluta"));
      return;
    }

    if (!fs.existsSync(workingDirectory)) {
      reject(
        new Error(
          `La ruta del proyecto no existe: ${workingDirectory}`
        )
      );
      return;
    }

    const allowedRoot = path.resolve("C:/proyectos");

    const resolvedDirectory = path.resolve(workingDirectory);

    if (!resolvedDirectory.startsWith(allowedRoot)) {
      reject(
        new Error(
          "Codex solamente puede trabajar dentro de C:/proyectos"
        )
      );
      return;
    }
    const validSandboxes = [
    "read-only",
    "workspace-write",
    ];

    if (!validSandboxes.includes(sandbox)) {
    reject(
        new Error(
        `Sandbox no permitido: ${sandbox}`
        )
    );
    return;
    }

    const configuredModel =
      model || process.env.CODEX_MODEL?.trim() || null;
    const startedAt = Date.now();
    const args = [
      "exec",
      "--json",
        "--color",
        "never",
        "--ephemeral",
        "--sandbox",
        sandbox,
      "--cd",
      resolvedDirectory,
    ];

    if (configuredModel) {
      args.push("--model", configuredModel);
    }

    args.push("-");

    const child = spawn(
      "codex",
      args,
      {
        cwd: resolvedDirectory,
        shell: true,
        windowsHide: true,
        env: process.env,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      console.log(`[CODEX] ${text}`);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      console.error(`[CODEX] ${text}`);
    });

    child.on("error", (error) => {
      reject(
        createProviderFailureError(
          error.message,
          error.code === "ENOENT"
            ? "CLI no disponible"
            : classifyCodexProviderFailure(
                error.message
              ) || "servicio no disponible"
        )
      );
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(
        createProviderFailureError(
          "Codex supero el tiempo maximo de 15 minutos",
          "timeout"
        )
      );
    }, MAX_EXECUTION_TIME);

    child.on("close", (code) => {
      clearTimeout(timeout);
      const parsedOutput =
        parseCodexJsonOutput(stdout);

      if (code !== 0) {
        const errorMessage =
          parsedOutput?.streamError ||
          stderr ||
          parsedOutput?.output ||
          stdout ||
          `Codex finalizo con codigo ${code}`;
        const providerFailureReason =
          parsedOutput?.streamError || stderr
            ? classifyCodexProviderFailure(
                errorMessage
              )
            : null;

        reject(
          providerFailureReason
            ? createProviderFailureError(
                errorMessage,
                providerFailureReason
              )
            : new Error(errorMessage)
        );
        return;
      }

      resolve({
        exitCode: code,
        output:
          parsedOutput?.output ||
          stdout.trim() ||
          stderr.trim(),
        usage: parsedOutput?.usage ?? null,
        model:
          parsedOutput?.model ??
          configuredModel ??
          null,
        costUsd: null,
        durationMs: Date.now() - startedAt,
        modelUsage: null,
        permissionDenials: null,
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
