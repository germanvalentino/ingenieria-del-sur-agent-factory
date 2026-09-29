import fs from "node:fs";
import path from "node:path";
import { executeAgent } from "./agent-runner.service.js";

const SPEC_WORKSPACE = path.resolve(
  process.env.SPECIFICATION_WORKSPACE ||
    "C:/proyectos/.agent-worktrees/specification-assistant"
);

function ensureWorkspace() {
  fs.mkdirSync(SPEC_WORKSPACE, { recursive: true });
  return SPEC_WORKSPACE;
}

function outputOf(result) {
  return String(result?.output || result?.result || result?.summary || "").trim();
}

function parseJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("El proveedor no devolvio JSON valido");
}

function providerError(error) {
  const message = String(error?.message || error || "Error desconocido");
  return /quota|rate.?limit|unauthor|auth|login|token|timeout|tiempo m[aá]ximo|not found|no se reconoce|enoent|cli|network|connection|models cache/i.test(message);
}

async function callProvider(provider, prompt) {
  try {
    const result = await executeAgent({
      provider,
      workingDirectory: ensureWorkspace(),
      prompt,
      sandbox: "read-only",
    });
    return { ok: true, provider, result, text: outputOf(result) };
  } catch (error) {
    return {
      ok: false,
      provider,
      providerError: providerError(error),
      error: String(error?.message || error),
    };
  }
}

function contextText({ idea, conversation = [] }) {
  const history = conversation.length
    ? conversation.map((item, index) => `${index + 1}. ${item.role}: ${item.content}`).join("\n")
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

export async function refineSpecification({ idea, conversation = [] }) {
  if (!String(idea || "").trim()) {
    const error = new Error("La idea es obligatoria");
    error.statusCode = 400;
    throw error;
  }

  const context = contextText({ idea: idea.trim(), conversation });
  const trace = [];

  const claudeAnalysis = await callProvider("claude", `
Sos el Analista Funcional de Ingenieria del Sur Agent Factory.
Analiza la solicitud. No inventes decisiones de producto. Detecta ambiguedades que puedan cambiar materialmente la implementacion, comportamiento o criterios verificables.
Si falta informacion importante, propone pocas preguntas concretas. Si alcanza, prepara un borrador estructurado.
${context}
${JSON_SCHEMA}`);
  trace.push(claudeAnalysis.ok
    ? { provider: "claude", stage: "functional-analysis", status: "completed" }
    : { provider: "claude", stage: "functional-analysis", status: "error", error: claudeAnalysis.error });

  const firstAnalysis = claudeAnalysis.ok ? claudeAnalysis.text : "Claude no estuvo disponible.";
  const codexReview = await callProvider("codex", `
Sos el Revisor Tecnico de Ingenieria del Sur Agent Factory.
Revisa criticamente la idea y el analisis funcional. Busca casos borde, decisiones tecnicas/funcionales faltantes y criterios que no sean verificables. No decidas por el usuario cuando existan alternativas con distinto comportamiento.
${context}
\nANALISIS FUNCIONAL DE CLAUDE:\n${firstAnalysis}
${JSON_SCHEMA}`);
  trace.push(codexReview.ok
    ? { provider: "codex", stage: "technical-review", status: "completed" }
    : { provider: "codex", stage: "technical-review", status: "error", error: codexReview.error });

  if (!claudeAnalysis.ok && !codexReview.ok) {
    const error = new Error(`No fue posible analizar la especificacion. Claude: ${claudeAnalysis.error}. Codex: ${codexReview.error}`);
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
\nANALISIS CLAUDE:\n${claudeAnalysis.ok ? claudeAnalysis.text : claudeAnalysis.error}
\nREVISION CODEX:\n${codexReview.ok ? codexReview.text : codexReview.error}
${JSON_SCHEMA}`;

  let synthesis = await callProvider("claude", synthesisPrompt);
  trace.push(synthesis.ok
    ? { provider: "claude", stage: "synthesis", status: "completed" }
    : { provider: "claude", stage: "synthesis", status: "error", error: synthesis.error });

  if (!synthesis.ok) {
    const fallback = await callProvider("codex", synthesisPrompt);
    trace.push(fallback.ok
      ? { provider: "codex", stage: "synthesis-fallback", status: "completed" }
      : { provider: "codex", stage: "synthesis-fallback", status: "error", error: fallback.error });
    synthesis = fallback;
  }

  if (!synthesis.ok) {
    const error = new Error(`No fue posible consolidar la especificacion: ${synthesis.error}`);
    error.statusCode = 503;
    throw error;
  }

  const specification = parseJson(synthesis.text);
  return {
    ...specification,
    status: specification.status === "READY" ? "READY" : "NEEDS_CLARIFICATION",
    trace,
    generatedBy: synthesis.provider,
  };
}
