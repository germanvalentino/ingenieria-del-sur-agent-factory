const PROVIDER_FAILURE_PATTERNS = [
  {
    reason: "rate limit o cuota",
    pattern:
      /\b(429|too\s+many\s+requests|rate\s*limit(?:ed)?|quota\s+exceeded|exceeded\s+quota|insufficient\s+quota|cuota\s+excedida|limite\s+de\s+cuota|l[ií]mite\s+de\s+cuota)\b/i,
  },
  {
    reason: "error 5xx del proveedor",
    pattern:
      /\b(http\s+(?:status\s+)?5\d\d|status\s+5\d\d|5\d\d\s+(?:internal\s+server\s+error|bad\s+gateway|gateway\s+timeout|service\s+unavailable)|internal\s+server\s+error|bad\s+gateway|gateway\s+timeout)\b/i,
  },
  {
    reason: "servicio no disponible",
    pattern:
      /\b(service\s+unavailable|temporarily\s+unavailable|service\s+temporarily\s+unavailable|provider\s+unavailable|server\s+unavailable|overloaded|econnreset|etimedout|eai_again)\b/i,
  },
  {
    reason: "error de autenticacion",
    pattern:
      /\b(unauthorized|authentication\s+(?:failed|required|error)|auth\s+(?:failed|required|error)|not\s+logged\s+in|oauth|api[_-]?key\s+(?:missing|invalid|required)|invalid\s+api[_-]?key|401)\b/i,
  },
  {
    reason: "timeout",
    pattern:
      /\b(gateway\s+timeout|request\s+timeout|operation\s+timeout|timeout|timed?\s*out|etimedout|tiempo\s+m[aá]ximo|super[oó]\s+el\s+tiempo|no\s+respond[ií]o)\b/i,
  },
  {
    reason: "CLI no disponible",
    pattern:
      /\b(command\s+not\s+found:\s*(codex|claude)|'(codex|claude)'\s+is\s+not\s+recognized|spawn\s+(codex|claude)(?:\.exe)?\s+enoent|(codex|claude)(?:\.exe)?\s+.*(?:not\s+recognized|no\s+se\s+reconoce|no\s+se\s+encontr[oó])|no\s+se\s+pudo\s+ejecutar\s+(codex|claude))\b/i,
  },
];

export function classifyProviderFailure(message) {
  const text = String(message || "");

  if (!text.trim()) {
    return null;
  }

  return (
    PROVIDER_FAILURE_PATTERNS.find(({ pattern }) =>
      pattern.test(text)
    )?.reason || null
  );
}

export function createProviderFailureError(
  message,
  reason = null
) {
  const error = new Error(message);
  error.isProviderFailure = true;
  error.providerFailureReason =
    reason ||
    classifyProviderFailure(message) ||
    "falla de proveedor";
  return error;
}
