const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "qwen2.5:7b";

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function getOllamaDefaultModel() {
  return process.env.OLLAMA_MODEL || DEFAULT_MODEL;
}

export function getOllamaCoderModel() {
  return process.env.OLLAMA_CODER_MODEL || "qwen2.5-coder:7b";
}

export async function executeOllama({
  prompt,
  model = null,
  timeoutMs = null,
}) {
  const selectedModel = model || getOllamaDefaultModel();
  const baseUrl = normalizeBaseUrl(process.env.OLLAMA_BASE_URL);
  const configuredTimeout = Number(
    timeoutMs || process.env.OLLAMA_TIMEOUT_MS || 120000
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), configuredTimeout);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        prompt: String(prompt || ""),
        stream: false,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Ollama devolvio una respuesta no JSON (HTTP ${response.status}): ${raw.slice(0, 500)}`);
    }

    if (!response.ok || data?.error) {
      throw new Error(`Ollama HTTP ${response.status}: ${data?.error || raw.slice(0, 500)}`);
    }

    const inputTokens = Number.isFinite(data.prompt_eval_count)
      ? data.prompt_eval_count
      : null;
    const cachedInputTokens = Number.isFinite(data.prompt_eval_cached_count)
      ? data.prompt_eval_cached_count
      : 0;
    const outputTokens = Number.isFinite(data.eval_count)
      ? data.eval_count
      : null;
    const totalTokens =
      inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : null;
    const durationMs = Number.isFinite(data.total_duration)
      ? Math.round(data.total_duration / 1_000_000)
      : Date.now() - startedAt;

    return {
      output: String(data.response || "").trim(),
      result: String(data.response || "").trim(),
      model: data.model || selectedModel,
      usage: {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        totalTokens,
      },
      costUsd: 0,
      durationMs,
      modelUsage: {
        provider: "ollama",
        model: data.model || selectedModel,
        loadDurationMs: Number.isFinite(data.load_duration)
          ? Math.round(data.load_duration / 1_000_000)
          : null,
        promptEvalDurationMs: Number.isFinite(data.prompt_eval_duration)
          ? Math.round(data.prompt_eval_duration / 1_000_000)
          : null,
        evalDurationMs: Number.isFinite(data.eval_duration)
          ? Math.round(data.eval_duration / 1_000_000)
          : null,
        doneReason: data.done_reason || null,
      },
      permissionDenials: null,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`Ollama timeout despues de ${configuredTimeout} ms`);
      timeoutError.isProviderFailure = true;
      timeoutError.providerFailureReason = "timeout";
      throw timeoutError;
    }

    const message = String(error?.message || error);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(message)) {
      error.isProviderFailure = true;
      error.providerFailureReason = "servicio no disponible";
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
