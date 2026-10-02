import { executeClaude, getClaudeDefaultModel } from "./claude.service.js";
import { executeCodex } from "./codex.service.js";
import { executeOllama, getOllamaDefaultModel } from "./ollama.service.js";
import { classifyProviderFailure } from "./provider-failure.service.js";

export const VALID_DEVELOPMENT_PROVIDERS = [
  "codex",
  "claude",
  "ollama",
];

const PROVIDER_FAILURE_PATTERNS = [
  {
    reason: "timeout",
    pattern:
      /\b(timeout|timed?\s*out|tiempo\s+maximo|tiempo\s+m[aá]ximo|super[oó]\s+el\s+tiempo)\b/i,
  },
  {
    reason: "rate limit o cuota",
    pattern:
      /\b(rate\s*limit|rate.?limited|quota|cuota|too\s+many\s+requests|429)\b/i,
  },
  {
    reason: "error 5xx del proveedor",
    pattern:
      /\b(http\s+status\s+5\d\d|status\s+5\d\d|5\d\d|500|502|503|504|internal\s+server\s+error|bad\s+gateway|gateway\s+timeout)\b/i,
  },
  {
    reason: "servicio no disponible",
    pattern:
      /\b(service\s+unavailable|temporarily\s+unavailable|overloaded|econnreset|etimedout|enotfound)\b/i,
  },
  {
    reason: "error de autenticacion",
    pattern:
      /\b(auth|authentication|autenticaci[oó]n|unauthorized|login|oauth|not\s+logged\s+in|api[_-]?key|401)\b/i,
  },
  {
    reason: "CLI no disponible",
    pattern:
      /\b(cli|command\s+not\s+found|is\s+not\s+recognized|no\s+se\s+reconoce|no\s+se\s+encontro|enoent|spawn\s+(codex|claude)(?:\.exe)?\s+enoent|executable)\b/i,
  },
];

const PROVIDER_CAPABILITIES = {
  ollama: {
    // Primera etapa: Ollama se habilita para razonamiento textual/especificacion.
    // No se anuncia como agente de desarrollo hasta agregar herramientas de archivos/shell.
    capabilities: new Set(["specification"]),
    tools: new Set(["read", "sandbox:read-only"]),
    permissions: new Set(["filesystem:read", "shell:limited"]),
  },
  codex: {
    capabilities: new Set([
      "development",
      "correction",
      "qa",
      "specification",
    ]),
    tools: new Set([
      "read",
      "write",
      "edit",
      "multi-edit",
      "glob",
      "grep",
      "ls",
      "shell:npm",
      "shell:node",
      "shell:git-status",
      "shell:git-diff",
      "shell:git-ls-files",
      "shell:rg",
      "sandbox:read-only",
      "sandbox:workspace-write",
    ]),
    permissions: new Set([
      "filesystem:read",
      "filesystem:write",
      "shell:limited",
    ]),
  },
  claude: {
    capabilities: new Set([
      "development",
      "correction",
      "qa",
      "specification",
    ]),
    tools: new Set([
      "read",
      "write",
      "edit",
      "multi-edit",
      "glob",
      "grep",
      "ls",
      "shell:npm",
      "shell:node",
      "shell:git-status",
      "shell:git-diff",
      "shell:git-ls-files",
      "shell:rg",
      "claude:settings",
      "sandbox:read-only",
      "sandbox:workspace-write",
    ]),
    permissions: new Set([
      "filesystem:read",
      "filesystem:write",
      "shell:limited",
    ]),
  },
};

export const CAPABILITY_REQUIRED_TOOLS = {
  development: [
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "ls",
    "shell:npm",
    "shell:node",
    "shell:git-status",
    "shell:git-diff",
    "shell:rg",
  ],
  correction: [
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "ls",
    "shell:npm",
    "shell:node",
    "shell:git-status",
    "shell:git-diff",
    "shell:rg",
  ],
  qa: [
    "read",
    "glob",
    "grep",
    "ls",
    "shell:npm",
    "shell:node",
    "shell:git-status",
    "shell:git-diff",
    "shell:git-ls-files",
    "shell:rg",
  ],
  specification: ["read"],
};

export function getRequiredToolsForCapability(capability) {
  return [
    ...(CAPABILITY_REQUIRED_TOOLS[
      String(capability || "").toLowerCase()
    ] || []),
  ];
}

function normalizeSandbox(sandbox) {
  const normalized = String(
    sandbox || "workspace-write"
  )
    .trim()
    .toLowerCase();

  return normalized || "workspace-write";
}

function permissionsForSandbox(sandbox) {
  const normalized = normalizeSandbox(sandbox);

  if (normalized === "read-only") {
    return ["filesystem:read", "shell:limited"];
  }

  return [
    "filesystem:read",
    "filesystem:write",
    "shell:limited",
  ];
}

function normalizeRequiredTools(requiredTools) {
  if (!Array.isArray(requiredTools)) {
    return [];
  }

  return [
    ...new Set(
      requiredTools
        .map((tool) =>
          String(tool || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    ),
  ];
}

function normalizePermissions(permissions) {
  if (!Array.isArray(permissions)) {
    return [];
  }

  return [
    ...new Set(
      permissions
        .map((permission) =>
          String(permission || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    ),
  ];
}

export function buildExecutionRequirements({
  capability,
  requiredTools = [],
  sandbox = "workspace-write",
  permissions = [],
} = {}) {
  const normalizedCapability = String(
    capability || ""
  ).toLowerCase();
  const normalizedSandbox = normalizeSandbox(sandbox);

  return {
    capability: normalizedCapability,
    sandbox: normalizedSandbox,
    requiredTools: normalizeRequiredTools([
      ...getRequiredToolsForCapability(
        normalizedCapability
      ),
      ...requiredTools,
      `sandbox:${normalizedSandbox}`,
    ]),
    permissions: normalizePermissions([
      ...permissionsForSandbox(normalizedSandbox),
      ...permissions,
    ]),
  };
}

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

export function getAlternativeProvider(provider) {
  const normalized = assertValidProvider(provider);
  if (normalized === "claude") return "codex";
  if (normalized === "codex") return "claude";
  return "claude";
}

export function getProviderFailure(error) {
  const explicitReason =
    error?.providerFailureReason ||
    error?.providerFailure?.reason ||
    null;

  if (error?.isProviderFailure || explicitReason) {
    return {
      isProviderFailure: true,
      reason:
        explicitReason || "falla de proveedor",
      message: String(
        error?.message || error || "Error desconocido"
      ),
    };
  }

  const message = String(
    error?.message || error || "Error desconocido"
  );
  const reason = classifyProviderFailure(message);

  return {
    isProviderFailure: Boolean(reason),
    reason,
    message,
  };
}

export function providerSupportsCapability({
  provider,
  capability,
  requiredTools = [],
  sandbox = "workspace-write",
  permissions = [],
  executionRequirements = null,
}) {
  return getProviderCapabilitySupport({
    provider,
    capability,
    requiredTools,
    sandbox,
    permissions,
    executionRequirements,
  }).supported;
}

export function getProviderCapabilitySupport({
  provider,
  capability,
  requiredTools = [],
  sandbox = "workspace-write",
  permissions = [],
  executionRequirements = null,
}) {
  const normalized = assertValidProvider(provider);
  const requirements =
    executionRequirements ||
    buildExecutionRequirements({
      capability,
      requiredTools,
      sandbox,
      permissions,
    });
  const normalizedCapability =
    requirements.capability;
  const support = PROVIDER_CAPABILITIES[normalized];

  if (
    !support?.capabilities.has(normalizedCapability)
  ) {
    return {
      supported: false,
      reason: `El proveedor ${normalized} no soporta la capacidad ${normalizedCapability}.`,
      missingTools: [],
      missingPermissions: [],
      executionRequirements: requirements,
    };
  }

  const missingTools = requirements.requiredTools.filter(
    (tool) => !support.tools.has(tool)
  );
  const missingPermissions =
    requirements.permissions.filter(
      (permission) =>
        !support.permissions.has(permission)
    );

  return {
    supported:
      missingTools.length === 0 &&
      missingPermissions.length === 0,
    reason:
      missingTools.length === 0 &&
      missingPermissions.length === 0
        ? null
        : `El proveedor ${normalized} no soporta los requisitos de ejecucion: ${[
            ...missingTools,
            ...missingPermissions,
          ].join(", ")}.`,
    missingTools,
    missingPermissions,
    executionRequirements: requirements,
  };
}

export function describeProviderFallbackEvent({
  originalProvider,
  reason,
  alternativeProvider,
  status,
  detail = null,
}) {
  return [
    "FALLBACK DE PROVEEDOR:",
    `Proveedor original: ${originalProvider}`,
    `Motivo: ${reason}`,
    `Proveedor alternativo: ${alternativeProvider}`,
    `Resultado: ${status}`,
    detail ? `Detalle: ${detail}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function getConfiguredModel(provider) {
  const normalized = assertValidProvider(provider);

  if (normalized === "claude") {
    return getClaudeDefaultModel();
  }

  if (normalized === "ollama") {
    return getOllamaDefaultModel();
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

  return getConfiguredModel(normalized);
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
  skipGitRepoCheck = false,
}) {
  const normalized = assertValidProvider(provider);

  if (normalized === "claude") {
    return executeClaude({
      workingDirectory,
      prompt,
      sandbox,
      model: getExecutionModel({
        provider: normalized,
        model,
      }),
    });
  }

  if (normalized === "ollama") {
    return executeOllama({
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
    model: getExecutionModel({
      provider: normalized,
      model,
    }),
    skipGitRepoCheck,
  });
}
