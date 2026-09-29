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

function contextText({ idea, conversation = [] }) {
  const history = conversation.length
    ? conversation
        .map(
          (item, index) =>
            `${index + 1}. ${item.role}: ${item.content}`
        )
        .join("\n")
    : "Sin respuestas previas.";

  return `IDEA ORIGINAL:\n${idea}\n\nCONVERSACION DE REFINAMIENTO:\n${history}`;
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
}) {
  if (!String(idea || "").trim()) {
    const error = new Error("La idea es obligatoria");
    error.statusCode = 400;
    throw error;
  }

  const context = contextText({
    idea: idea.trim(),
    conversation,
  });
  const trace = [];

  const claudeAnalysis =
    await callProviderWithFallback({
      provider: "claude",
      stage: "functional-analysis",
      trace,
      prompt: `
Sos el Analista Funcional de Ingenieria del Sur Agent Factory.
Analiza la solicitud. No inventes decisiones de producto. Detecta ambiguedades que puedan cambiar materialmente la implementacion, comportamiento o criterios verificables.
Si falta informacion importante, propone pocas preguntas concretas. Si alcanza, prepara un borrador estructurado.
      ${context}
${JSON_SCHEMA}`,
    });

  abortIfProviderFallbackFailed(claudeAnalysis, trace);

  const firstAnalysis = claudeAnalysis.ok
    ? claudeAnalysis.text
    : "Claude no estuvo disponible.";
  const codexReview =
    await callProviderWithFallback({
      provider: "codex",
      stage: "technical-review",
      trace,
      prompt: `
Sos el Revisor Tecnico de Ingenieria del Sur Agent Factory.
Revisa criticamente la idea y el analisis funcional. Busca casos borde, decisiones tecnicas/funcionales faltantes y criterios que no sean verificables. No decidas por el usuario cuando existan alternativas con distinto comportamiento.
${context}

ANALISIS FUNCIONAL DE CLAUDE:
${firstAnalysis}
${JSON_SCHEMA}`,
    });

  abortIfProviderFallbackFailed(codexReview, trace);

  if (!claudeAnalysis.ok && !codexReview.ok) {
    const error = new Error(
      `No fue posible analizar la especificacion. Claude: ${claudeAnalysis.error}. Codex: ${codexReview.error}`
    );
    error.statusCode = 503;
    throw error;
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
${context}

ANALISIS CLAUDE:
${claudeAnalysis.ok ? claudeAnalysis.text : claudeAnalysis.error}

REVISION CODEX:
${codexReview.ok ? codexReview.text : codexReview.error}
${JSON_SCHEMA}`;

  const synthesis = await callProviderWithFallback({
    provider: "claude",
    stage: "synthesis",
    trace,
    prompt: synthesisPrompt,
  });

  if (!synthesis.ok) {
    const error = new Error(
      `No fue posible consolidar la especificacion: ${synthesis.error}`
    );
    error.statusCode = 503;
    throw error;
  }

  const specification = parseJson(synthesis.text);

  return {
    ...specification,
    status:
      specification.status === "READY"
        ? "READY"
        : "NEEDS_CLARIFICATION",
    trace,
    generatedBy: synthesis.provider,
  };
}
