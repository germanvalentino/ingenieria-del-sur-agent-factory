import fs from "node:fs";
import path from "node:path";
import {
  buildExecutionRequirements,
  describeProviderFallbackEvent,
  executeAgent,
  getAlternativeProvider,
  getProviderCapabilitySupport,
  getProviderFailure,
} from "./agent-runner.service.js";
import { MAX_EXTRACTED_CHARS } from "./pdf-attachment.service.js";
import { preprocessRequest } from "./request-preprocessor.service.js";
import { executeOllama } from "./ollama.service.js";

const SPEC_WORKSPACE = path.resolve(
  process.env.SPECIFICATION_WORKSPACE ||
    "C:/proyectos/.agent-worktrees/specification-assistant"
);

function ensureWorkspace() {
  fs.mkdirSync(SPEC_WORKSPACE, { recursive: true });
  return SPEC_WORKSPACE;
}

function outputOf(result) {
  return String(
    result?.output || result?.result || result?.summary || ""
  ).trim();
}


function logSpecMetrics(stage, callResult, prompt) {
  const result = callResult?.result || {};
  const usage = result?.usage || {};
  const input = usage.inputTokens ?? null;
  const cached = usage.cachedInputTokens ?? null;
  const uncached =
    input !== null && cached !== null
      ? Math.max(0, input - cached)
      : null;

  console.log(
    `[SPEC-METRICS] stage=${stage}` +
      ` provider=${callResult?.provider || "unknown"}` +
      ` model=${result?.model || "unknown"}` +
      ` promptChars=${String(prompt || "").length}` +
      ` inputTokens=${input ?? "n/a"}` +
      ` cachedInputTokens=${cached ?? "n/a"}` +
      ` uncachedInputTokens=${uncached ?? "n/a"}` +
      ` outputTokens=${usage.outputTokens ?? "n/a"}` +
      ` totalTokens=${usage.totalTokens ?? "n/a"}` +
      ` costUsd=${result?.costUsd ?? "n/a"}` +
      ` durationMs=${result?.durationMs ?? "n/a"}`
  );
}


function envFlag(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === "") return defaultValue;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

async function runOllamaSynthesisAb(prompt) {
  if (!envFlag("SPEC_SYNTHESIS_AB_OLLAMA", false)) {
    return null;
  }

  const model =
    process.env.SPEC_SYNTHESIS_OLLAMA_MODEL ||
    process.env.OLLAMA_MODEL ||
    "qwen2.5:7b";

  try {
    const result = await executeOllama({
      prompt,
      model,
      timeoutMs: Number(
        process.env.SPEC_SYNTHESIS_OLLAMA_TIMEOUT_MS ||
        process.env.OLLAMA_TIMEOUT_MS ||
        180000
      ),
    });

    console.log(
      `[SPEC-AB] stage=synthesis provider=ollama` +
        ` model=${result.model || model}` +
        ` promptChars=${String(prompt || "").length}` +
        ` outputChars=${String(result.output || "").length}` +
        ` inputTokens=${result.usage?.inputTokens ?? "n/a"}` +
        ` outputTokens=${result.usage?.outputTokens ?? "n/a"}` +
        ` totalTokens=${result.usage?.totalTokens ?? "n/a"}` +
        ` costUsd=0` +
        ` durationMs=${result.durationMs ?? "n/a"}`
    );

    return { ok: true, result, text: String(result.output || "").trim() };
  } catch (error) {
    console.warn(
      `[SPEC-AB] stage=synthesis provider=ollama status=error error=${String(
        error?.message || error
      )}`
    );
    return { ok: false, error: String(error?.message || error) };
  }
}

function saveSynthesisAbComparison({ prompt, claude, ollama }) {
  if (!ollama) return;

  try {
    const dir = path.join(ensureWorkspace(), "ab-synthesis");
    fs.mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `synthesis-${stamp}.json`);

    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          note:
            "A/B experimental. La respuesta productiva sigue siendo exclusivamente Claude.",
          promptChars: String(prompt || "").length,
          claude: {
            ok: Boolean(claude?.ok),
            provider: claude?.provider || "claude",
            model: claude?.result?.model || null,
            output: claude?.text || "",
            outputChars: String(claude?.text || "").length,
            usage: claude?.result?.usage || null,
            costUsd: claude?.result?.costUsd ?? null,
            durationMs: claude?.result?.durationMs ?? null,
          },
          ollama: ollama.ok
            ? {
                ok: true,
                provider: "ollama",
                model: ollama.result?.model || null,
                output: ollama.text || "",
                outputChars: String(ollama.text || "").length,
                usage: ollama.result?.usage || null,
                costUsd: 0,
                durationMs: ollama.result?.durationMs ?? null,
              }
            : {
                ok: false,
                provider: "ollama",
                error: ollama.error,
              },
        },
        null,
        2
      ),
      "utf8"
    );

    console.log(`[SPEC-AB] comparisonFile=${file}`);
  } catch (error) {
    console.warn(
      `[SPEC-AB] No se pudo guardar la comparacion: ${String(
        error?.message || error
      )}`
    );
  }
}

function parseJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  throw new Error("El proveedor no devolvio JSON valido");
}

async function callProvider(provider, prompt) {
  try {
    const result = await executeAgent({
      provider,
      workingDirectory: ensureWorkspace(),
      prompt,
      sandbox: "read-only",
      skipGitRepoCheck: true,
    });

    return {
      ok: true,
      provider,
      result,
      text: outputOf(result),
    };
  } catch (error) {
    const providerFailure = getProviderFailure(error);

    return {
      ok: false,
      provider,
      providerError: providerFailure.isProviderFailure,
      providerFailureReason: providerFailure.reason,
      error: String(error?.message || error),
    };
  }
}

async function callProviderWithFallback({
  provider,
  prompt,
  stage,
  trace,
}) {
  const primary = await callProvider(provider, prompt);

  trace.push(
    primary.ok
      ? { provider, stage, status: "completed" }
      : {
          provider,
          stage,
          status: "error",
          error: primary.error,
        }
  );

  if (primary.ok || !primary.providerError) {
    return primary;
  }

  const alternativeProvider =
    getAlternativeProvider(provider);
  const fallbackReason =
    primary.providerFailureReason ||
    "falla de proveedor";

  const capabilitySupport =
    getProviderCapabilitySupport({
      provider: alternativeProvider,
      executionRequirements:
        buildExecutionRequirements({
          capability: "specification",
          sandbox: "read-only",
        }),
    });

  if (!capabilitySupport.supported) {
    const detail =
      capabilitySupport.reason ||
      "El proveedor alternativo no soporta Specification Assistant";
    trace.push({
      provider: alternativeProvider,
      stage: `${stage}-fallback`,
      status: "skipped",
      fallbackFrom: provider,
      fallbackReason,
      error: detail,
    });

    primary.error = describeProviderFallbackEvent({
      originalProvider: provider,
      reason: fallbackReason,
      alternativeProvider,
      status: "omitido",
      detail,
    });

    return primary;
  }

  trace.push({
    provider: alternativeProvider,
    stage: `${stage}-fallback`,
    status: "started",
    fallbackFrom: provider,
    fallbackReason,
  });

  const fallback = await callProvider(
    alternativeProvider,
    prompt
  );

  trace.push(
    fallback.ok
      ? {
          provider: alternativeProvider,
          stage: `${stage}-fallback`,
          status: "completed",
          fallbackFrom: provider,
          fallbackReason,
        }
      : {
          provider: alternativeProvider,
          stage: `${stage}-fallback`,
          status: "error",
          fallbackFrom: provider,
          fallbackReason,
          error: fallback.error,
        }
  );

  if (!fallback.ok && fallback.providerError) {
    fallback.error = describeProviderFallbackEvent({
      originalProvider: provider,
      reason: fallbackReason,
      alternativeProvider,
      status: "fallido",
      detail: fallback.error,
    });
  }

  return fallback;
}

function abortIfProviderFallbackFailed(result, trace) {
  if (result.ok || !result.providerError) {
    return;
  }

  const error = new Error(
    `No fue posible continuar por falla de proveedor: ${result.error}`
  );
  error.statusCode = 503;
  error.trace = trace;
  throw error;
}

function normalizeAttachments(attachments = []) {
  return attachments
    .map((attachment) => ({
      fileName: String(attachment?.fileName || "").trim(),
      text: String(attachment?.text || "")
        .trim()
        .slice(0, MAX_EXTRACTED_CHARS),
    }))
    .filter((attachment) => attachment.fileName && attachment.text);
}

function contextText({ idea, conversation = [], attachments = [] }) {
  const history = conversation.length
    ? conversation
        .map(
          (item, index) =>
            `${index + 1}. ${item.role}: ${item.content}`
        )
        .join("\n")
    : "Sin respuestas previas.";

  const documentsSection = attachments.length
    ? `\n\nCONTEXTO DOCUMENTAL ADJUNTO (PDFs aportados por el usuario, usar como contexto adicional sin reemplazar su pedido):\n${attachments
        .map(
          (doc, index) =>
            `--- Documento ${index + 1}: ${doc.fileName} ---\n${doc.text}`
        )
        .join("\n\n")}`
    : "";

  return `IDEA ORIGINAL:\n${idea}\n\nCONVERSACION DE REFINAMIENTO:\n${history}${documentsSection}`;
}

const JSON_SCHEMA = `Devuelve SOLO JSON valido, sin markdown, con esta estructura exacta:
{
  "status": "READY" | "NEEDS_CLARIFICATION",
  "questions": ["pregunta concreta"],
  "title": "titulo breve o vacio",
  "description": "descripcion funcional clara o vacia",
  "requirements": ["RF01. ..."],
  "acceptanceCriteria": ["AC01. Given ... When ... Then ..."],
  "constraints": ["..."],
  "outOfScope": ["..."],
  "notes": ["..."]
}`;

export async function refineSpecification({
  idea,
  conversation = [],
  attachments = [],
  onProgress = null,
}) {
  if (!String(idea || "").trim()) {
    const error = new Error("La idea es obligatoria");
    error.statusCode = 400;
    throw error;
  }

  const normalizedAttachments = normalizeAttachments(attachments);
  const context = contextText({
    idea: idea.trim(),
    conversation,
    attachments: normalizedAttachments,
  });
  const trace = [];

  // Capa local opcional. Si esta deshabilitada, el pedido es corto o Ollama falla,
  // effectiveContext queda identico al contexto original.
  const preprocessed = await preprocessRequest({ input: context });
  const effectiveContext = preprocessed.used
    ? `CONTEXTO NORMALIZADO LOCALMENTE (Ollama):\n${preprocessed.normalizedText}`
    : context;

  trace.push({
    provider: "ollama",
    stage: "preprocessing",
    status: preprocessed.used ? "completed" : "bypassed",
    reason: preprocessed.reason,
    metrics: preprocessed.metrics,
  });

  const reportProgress = async (event) => {
    if (typeof onProgress !== "function") return;
    try {
      await onProgress(event);
    } catch (error) {
      console.error("[SPEC_PROGRESS]", error);
    }
  };

  const specificationStartedAt = Date.now();
  const parallelStartedAt = Date.now();

  await reportProgress({
    stage: "parallel-analysis",
    status: "started",
    message: "Analizando funcional y tecnicamente tu solicitud en paralelo...",
  });

  const functionalPrompt = `
Sos el Analista Funcional de Ingenieria del Sur Agent Factory.
Hace un ANALISIS INTERMEDIO COMPACTO de la solicitud. Tu salida sera consumida por otro agente que redactara la especificacion final.

REGLAS:
- No inventes decisiones de producto.
- Detecta solamente ambiguedades que puedan cambiar materialmente la implementacion, el comportamiento o los criterios verificables.
- Si falta informacion importante, formula como maximo 3 preguntas concretas.
- Resume los requisitos funcionales; no redactes una especificacion final extensa.
- No desarrolles criterios Given/When/Then completos: usa acceptanceCriteria solo como pistas breves para la sintesis final.
- No repitas ni parafrasees innecesariamente la solicitud original.
- Mantene requirements, constraints, outOfScope y notes breves, sin explicaciones redundantes.
- Si la informacion alcanza, usa status READY.
- Prioriza precision y cobertura sobre prosa.

      ${effectiveContext}
${JSON_SCHEMA}`;

  // IMPORTANTE: para poder ejecutarse en paralelo, Codex hace una revision
  // tecnica independiente sobre la misma solicitud original. La consolidacion
  // posterior de Claude cruza ambos resultados.
  const technicalPrompt = `
Sos el Revisor Tecnico de Ingenieria del Sur Agent Factory.
Hace una REVISION TECNICA INTERMEDIA COMPACTA e independiente de la solicitud. Tu salida sera consumida por otro agente que consolidara la especificacion final.

REGLAS:
- No inventes decisiones de producto.
- Distingui estrictamente entre una PREGUNTA BLOQUEANTE y una OBSERVACION TECNICA.
- Una pregunta es bloqueante SOLO si su respuesta puede cambiar materialmente el comportamiento observable, el alcance, los datos persistidos, una integracion externa o un criterio de aceptacion.
- No preguntes decisiones internas de implementacion que el desarrollador pueda resolver razonablemente respetando la solicitud.
- No preguntes detalles ya determinados por el contexto o por frases como "mantener el comportamiento/estilo actual", "usar la funcion existente" o equivalentes.
- Casos borde, riesgos, sugerencias y decisiones tecnicas no bloqueantes deben ir en notes, constraints o requirements; NO en questions.
- Formula como maximo 3 preguntas bloqueantes. Cero preguntas es preferible cuando existe una implementacion razonable que respeta literalmente la solicitud sin introducir decisiones de producto.
- Si no existen preguntas bloqueantes, usa status READY aunque existan observaciones tecnicas.
- Resume requirements, constraints, outOfScope, acceptanceCriteria y notes. No redactes una especificacion final extensa.
- No repitas innecesariamente la solicitud original.
- Prioriza criterios verificables y problemas que realmente puedan impedir una implementacion correcta.

${effectiveContext}
${JSON_SCHEMA}`;

  const functionalPromise = callProviderWithFallback({
    provider: "claude",
    stage: "functional-analysis",
    trace,
    prompt: functionalPrompt,
  }).then(async (result) => {
    logSpecMetrics("functional-analysis", result, functionalPrompt);
    await reportProgress({
      stage: "functional-analysis",
      status: "completed",
      provider: result.provider,
      message: "Analisis funcional terminado.",
    });
    return result;
  });

  const technicalPromise = callProviderWithFallback({
    provider: "codex",
    stage: "technical-review",
    trace,
    prompt: technicalPrompt,
  }).then(async (result) => {
    logSpecMetrics("technical-review", result, technicalPrompt);
    await reportProgress({
      stage: "technical-review",
      status: "completed",
      provider: result.provider,
      message: "Revision tecnica terminada.",
    });
    return result;
  });

  const [claudeAnalysis, codexReview] = await Promise.all([
    functionalPromise,
    technicalPromise,
  ]);

  abortIfProviderFallbackFailed(claudeAnalysis, trace);
  abortIfProviderFallbackFailed(codexReview, trace);

  await reportProgress({
    stage: "parallel-analysis",
    status: "completed",
    message: "Analisis funcional y revision tecnica terminados. Estoy consolidando la especificacion...",
  });

  console.log(
    `[SPEC-METRICS] stage=parallel-analysis durationMs=${Date.now() - parallelStartedAt}`
  );

  if (!claudeAnalysis.ok && !codexReview.ok) {
    const error = new Error(
      `No fue posible analizar la especificacion. Claude: ${claudeAnalysis.error}. Codex: ${codexReview.error}`
    );
    error.statusCode = 503;
    throw error;
  }

  // Fast Path productivo.
  // Si ambos analisis independientes estan READY y no tienen preguntas
  // bloqueantes, consolida localmente sin una tercera llamada LLM.
  const fastPathEnabled = envFlag("SPEC_FAST_PATH_ENABLED", false);

  const parseAnalysisForFastPath = (result) => {
    if (!result?.ok) {
      return { ok: false, reason: "provider-not-ok", data: null };
    }
    try {
      const data = parseJson(result.text);
      return { ok: true, reason: null, data };
    } catch {
      return { ok: false, reason: "invalid-json", data: null };
    }
  };

  const evaluateFastPath = () => {
    if (!fastPathEnabled) {
      return {
        enabled: false,
        eligible: false,
        decision: "SYNTHESIS",
        reasons: ["disabled"],
        functional: null,
        technical: null,
      };
    }

    const functional = parseAnalysisForFastPath(claudeAnalysis);
    const technical = parseAnalysisForFastPath(codexReview);
    const reasons = [];

    if (!functional.ok) reasons.push(`functional-${functional.reason}`);
    if (!technical.ok) reasons.push(`technical-${technical.reason}`);

    if (functional.ok) {
      if (functional.data?.status !== "READY") reasons.push("functional-not-ready");
      if ((functional.data?.questions || []).length > 0)
        reasons.push("functional-has-questions");
    }

    if (technical.ok) {
      if (technical.data?.status !== "READY") reasons.push("technical-not-ready");
      if ((technical.data?.questions || []).length > 0)
        reasons.push("technical-has-questions");
    }

    const eligible = reasons.length === 0;

    return {
      enabled: true,
      eligible,
      decision: eligible ? "FAST_PATH" : "SYNTHESIS",
      reasons,
      functional,
      technical,
      functionalStatus: functional.data?.status || null,
      technicalStatus: technical.data?.status || null,
      functionalQuestions: functional.data?.questions?.length || 0,
      technicalQuestions: technical.data?.questions?.length || 0,
    };
  };

  const fastPath = evaluateFastPath();

  console.log(
    `[SPEC-FAST-PATH] mode=productive decision=${fastPath.decision}` +
      ` eligible=${fastPath.eligible}` +
      ` reasons=${fastPath.reasons.join(",") || "none"}` +
      ` functionalStatus=${fastPath.functionalStatus || "n/a"}` +
      ` technicalStatus=${fastPath.technicalStatus || "n/a"}` +
      ` functionalQuestions=${fastPath.functionalQuestions ?? 0}` +
      ` technicalQuestions=${fastPath.technicalQuestions ?? 0}`
  );

  trace.push({
    provider: "local",
    stage: "fast-path",
    status: "completed",
    decision: fastPath.decision,
    eligible: fastPath.eligible,
    reasons: fastPath.reasons,
  });

  const normalizeArray = (value) =>
    Array.isArray(value)
      ? value
          .map((item) => (typeof item === "string" ? item.trim() : item))
          .filter((item) => item !== "" && item != null)
      : [];

  const stableKey = (value) =>
    typeof value === "string"
      ? value.toLowerCase().replace(/\s+/g, " ").trim()
      : JSON.stringify(value);

  const mergeUnique = (...arrays) => {
    const result = [];
    const seen = new Set();
    for (const array of arrays) {
      for (const item of normalizeArray(array)) {
        const key = stableKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(item);
      }
    }
    return result;
  };

  const buildFastPathSpecification = (functional, technical) => {
    const f = functional || {};
    const t = technical || {};

    // Functional es la base semantica. Technical solo complementa listas
    // verificables/no bloqueantes; no sobreescribe decisiones funcionales.
    return {
      status: "READY",
      title: f.title || t.title || "Especificacion",
      description: f.description || f.summary || t.description || t.summary || idea,
      requirements: mergeUnique(f.requirements, t.requirements),
      acceptanceCriteria: mergeUnique(
        f.acceptanceCriteria,
        t.acceptanceCriteria
      ),
      constraints: mergeUnique(f.constraints, t.constraints),
      outOfScope: mergeUnique(f.outOfScope, t.outOfScope),
      questions: [],
      notes: mergeUnique(f.notes, t.notes),
    };
  };

  if (fastPath.eligible) {
    const finalSpec = buildFastPathSpecification(
      fastPath.functional.data,
      fastPath.technical.data
    );

    const totalDurationMs = Date.now() - specificationStartedAt;
    console.log(
      `[SPEC-METRICS] stage=specification-total durationMs=${totalDurationMs} fastPath=true`
    );

    trace.push({
      provider: "local",
      stage: "synthesis",
      status: "skipped",
      reason: "fast-path",
      durationMs: 0,
      costUsd: 0,
    });

    await reportProgress({
      stage: "synthesis",
      status: "completed",
      provider: "local-fast-path",
      skippedLlm: true,
    });

    return {
      ...finalSpec,
      status: "READY",
      trace,
      generatedBy: "local-fast-path",
      sourceDocuments: normalizedAttachments.map(
        (doc) => doc.fileName
      ),
    };
  }

  const synthesisPrompt = `
Sos el Orquestador de Especificaciones de Ingenieria del Sur Agent Factory.
Consolida la solicitud, las respuestas del usuario y las revisiones de los agentes.
REGLAS:
- Si falta una decision que pueda cambiar materialmente el resultado, status NEEDS_CLARIFICATION y pregunta al usuario antes de escribir la especificacion final.
- Formula como maximo 5 preguntas, agrupando las relacionadas.
- No preguntes detalles que el equipo tecnico pueda resolver sin cambiar el comportamiento esperado.
- Si la informacion es suficiente, status READY, questions vacio y genera titulo, descripcion, requisitos y criterios de aceptacion completos.
- Los criterios deben ser comprobables y preferentemente Given/When/Then.
- No inventes alcance adicional.
${effectiveContext}

ANALISIS CLAUDE:
${claudeAnalysis.ok ? claudeAnalysis.text : claudeAnalysis.error}

REVISION CODEX:
${codexReview.ok ? codexReview.text : codexReview.error}
${JSON_SCHEMA}`;

  // A/B seguro: Claude sigue siendo la salida productiva.
  // Si el experimento esta habilitado, Ollama recibe exactamente el mismo prompt.
  const ollamaAbPromise = runOllamaSynthesisAb(synthesisPrompt);

  const synthesis = await callProviderWithFallback({
    provider: "claude",
    stage: "synthesis",
    trace,
    prompt: synthesisPrompt,
  });

  logSpecMetrics("synthesis", synthesis, synthesisPrompt);

  const ollamaAb = await ollamaAbPromise;
  saveSynthesisAbComparison({
    prompt: synthesisPrompt,
    claude: synthesis,
    ollama: ollamaAb,
  });

  if (ollamaAb?.ok) {
    console.log(
      `[SPEC-AB] claudeOutputChars=${String(synthesis.text || "").length}` +
        ` ollamaOutputChars=${String(ollamaAb.text || "").length}` +
        ` productiveProvider=claude`
    );
  }

  if (!synthesis.ok) {
    const error = new Error(
      `No fue posible consolidar la especificacion: ${synthesis.error}`
    );
    error.statusCode = 503;
    throw error;
  }

  console.log(
    `[SPEC-METRICS] stage=specification-total durationMs=${Date.now() - specificationStartedAt}`
  );

  const specification = parseJson(synthesis.text);

  return {
    ...specification,
    status:
      specification.status === "READY"
        ? "READY"
        : "NEEDS_CLARIFICATION",
    trace,
    generatedBy: synthesis.provider,
    sourceDocuments: normalizedAttachments.map(
      (doc) => doc.fileName
    ),
  };
}
