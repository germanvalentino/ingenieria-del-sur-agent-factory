import { executeClaude, getClaudeDefaultModel } from "./claude.service.js";
import { executeCodex } from "./codex.service.js";

export const VALID_DEVELOPMENT_PROVIDERS = [
  "codex",
  "claude",
];

export function normalizeProvider(provider) {
  return String(provider || "codex").toLowerCase();
}

export function assertValidProvider(provider) {
  const normalized = normalizeProvider(provider);

  if (!VALID_DEVELOPMENT_PROVIDERS.includes(normalized)) {
    const error = new Error(
      `Proveedor no permitido: ${provider}`
    );
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

export function getConfiguredModel(provider) {
  const normalized = assertValidProvider(provider);

  if (normalized === "claude") {
    return getClaudeDefaultModel();
  }

  return process.env.CODEX_MODEL || null;
}

export function getDisplayModel(provider) {
  const normalized = assertValidProvider(provider);

  if (normalized === "claude") {
    return getConfiguredModel("claude") ===
      "sonnet"
      ? "claude-sonnet-5"
      : getConfiguredModel("claude");
  }

  return getConfiguredModel("codex");
}

export function getModelForHistory({
  provider,
  model = null,
}) {
  const normalized = assertValidProvider(provider);

  if (normalized === "claude") {
    return model === "sonnet"
      ? "claude-sonnet-5"
      : model || getDisplayModel(normalized);
  }

  return model || getDisplayModel(normalized);
}

export function getExecutionModel({
  provider,
  model = null,
}) {
  const normalized = assertValidProvider(provider);

  if (normalized !== "claude") {
    return model || getConfiguredModel(normalized);
  }

  if (!model) {
    return getConfiguredModel("claude");
  }

  if (model === "claude-sonnet-5") {
    return "sonnet";
  }

  return model;
}

export function executeAgent({
  provider,
  workingDirectory,
  prompt,
  sandbox = "workspace-write",
  model = null,
}) {
  const normalized = assertValidProvider(provider);

  if (normalized === "claude") {
    return executeClaude({
      workingDirectory,
      prompt,
      model: getExecutionModel({
        provider: normalized,
        model,
      }),
    });
  }

  return executeCodex({
    workingDirectory,
    prompt,
    sandbox,
  });
}
