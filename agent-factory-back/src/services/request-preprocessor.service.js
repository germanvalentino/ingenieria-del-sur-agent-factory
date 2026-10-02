import { executeOllama, getOllamaDefaultModel } from "./ollama.service.js";

function envEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.OLLAMA_PREPROCESSOR_ENABLED || "false").trim());
}

function bypass(input, reason) {
  const original = String(input || "").trim();
  console.log(`[PREPROCESSOR] BYPASS chars=${original.length} reason=${reason}`);
  return { enabled: envEnabled(), used: false, reason, original, normalizedText: original, normalized: null, metrics: null };
}

function cleanJson(value) {
  const text = String(value || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

export async function preprocessRequest({ input, model = null } = {}) {
  const original = String(input || "").trim();
  if (!original) return bypass(original, "empty-input");
  if (!envEnabled()) return bypass(original, "disabled");

  const minChars = Math.max(0, Number(process.env.OLLAMA_PREPROCESSOR_MIN_CHARS || 500));
  if (original.length < minChars) return bypass(original, "below-threshold");

  const maxChars = Math.max(minChars, Number(process.env.OLLAMA_PREPROCESSOR_MAX_CHARS || 30000));
  if (original.length > maxChars) {
    // No truncamos silenciosamente: si excede el limite, preservamos el flujo actual.
    return bypass(original, "above-max-chars");
  }

  const prompt = `
Sos el preprocesador LOCAL de Agent Factory. Compacta el contexto para otro LLM sin cambiar su significado.
Devolve SOLAMENTE JSON valido, sin markdown, con esta estructura:
{
  "intent": "feature|bug|question|refactor|qa|other",
  "summary": "resumen fiel",
  "requirements": ["..."],
  "constraints": ["..."],
  "acceptanceHints": ["..."],
  "relevantContext": ["..."],
  "normalizedText": "contexto compacto y autosuficiente"
}
REGLAS CRITICAS:
- No inventes, completes ni resuelvas decisiones faltantes.
- Conserva TODOS los nombres tecnicos, endpoints, archivos, errores, numeros, limites, estados, restricciones y decisiones del usuario.
- Conserva preguntas/respuestas previas y datos de documentos cuando sean relevantes.
- Si hay ambiguedad, conservala.
- normalizedText debe ser compacto, pero la fidelidad tiene prioridad sobre acortar.

CONTEXTO ORIGINAL:
${original}
`.trim();

  try {
    const result = await executeOllama({
      prompt,
      model: model || process.env.OLLAMA_PREPROCESSOR_MODEL || getOllamaDefaultModel(),
    });
    const parsed = JSON.parse(cleanJson(result.output));
    const normalizedText = String(parsed?.normalizedText || "").trim();
    if (!normalizedText) return bypass(original, "invalid-output");

    const metrics = {
      provider: "ollama",
      model: result.model,
      inputTokens: result.usage?.inputTokens ?? null,
      cachedInputTokens: result.usage?.cachedInputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? null,
      totalTokens: result.usage?.totalTokens ?? null,
      durationMs: result.durationMs ?? null,
      costUsd: 0,
      originalChars: original.length,
      normalizedChars: normalizedText.length,
      reductionPct: original.length ? Math.round((1 - normalizedText.length / original.length) * 1000) / 10 : 0,
    };
    console.log(`[PREPROCESSOR] OLLAMA model=${result.model} originalChars=${original.length} normalizedChars=${normalizedText.length} reductionPct=${metrics.reductionPct} inputTokens=${metrics.inputTokens} outputTokens=${metrics.outputTokens} durationMs=${metrics.durationMs} costUsd=0`);

    return {
      enabled: true,
      used: true,
      reason: "ok",
      original,
      normalizedText,
      normalized: {
        intent: parsed.intent || "other",
        summary: parsed.summary || "",
        requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [],
        constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
        acceptanceHints: Array.isArray(parsed.acceptanceHints) ? parsed.acceptanceHints : [],
        relevantContext: Array.isArray(parsed.relevantContext) ? parsed.relevantContext : [],
      },
      metrics,
    };
  } catch (error) {
    console.warn(`[PREPROCESSOR] Ollama omitido; se conserva contexto original: ${error?.message || error}`);
    return bypass(original, "ollama-error");
  }
}
