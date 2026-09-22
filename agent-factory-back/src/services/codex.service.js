import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_EXECUTION_TIME = 15 * 60 * 1000;

function toNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const inputTokens = toNumberOrNull(
    usage.input_tokens
  );
  const outputTokens = toNumberOrNull(
    usage.output_tokens
  );
  const totalTokens = toNumberOrNull(
    usage.total_tokens
  );

  return {
    inputTokens,
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

      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        typeof event.item.text === "string"
      ) {
        agentMessages.push(event.item.text);
      }

      if (event.type === "turn.completed") {
        usage = normalizeUsage(event.usage);
        model =
          event.model ??
          event.provider_model ??
          model;
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
      return null;
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

    const child = spawn(
      "codex",
      [
        "exec",
        "--json",
        "--color",
        "never",
        "--ephemeral",
        "--sandbox",
        sandbox,
        "--cd",
        resolvedDirectory,
        "-",
      ],
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
      reject(error);
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error("Codex superó el tiempo máximo de 15 minutos")
      );
    }, MAX_EXECUTION_TIME);

    child.on("close", (code) => {
      clearTimeout(timeout);
      const parsedOutput =
        parseCodexJsonOutput(stdout);

      if (code !== 0) {
        reject(
          new Error(
            parsedOutput?.streamError ||
              stderr ||
              parsedOutput?.output ||
              stdout ||
              `Codex finalizó con código ${code}`
          )
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
        model: parsedOutput?.model ?? null,
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
