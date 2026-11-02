import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
const exec = promisify(execFile);
export function classifyVerdict(output) {
  const normalizedOutput = String(output ?? "")
    // Los proveedores pueden anteponer secuencias ANSI o envolver el
    // marcador con formato Markdown. Eso no debe cambiar el veredicto.
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/^\uFEFF/, "");

  for (const line of normalizedOutput.split(/\r?\n/)) {
    const normalizedLine = line
      .trim()
      .replace(/^(?:```(?:text|markdown)?\s*)/i, "")
      .replace(/^(?:\*\*|__)/, "")
      .replace(/(?:\*\*|__)$/, "")
      .trim();

    // El primer marcador independiente es definitivo. Las menciones
    // posteriores forman parte del resumen y nunca deben sobrescribirlo.
    if (normalizedLine === "QA_PASS") {
      return "passed";
    }

    if (normalizedLine === "QA_FAIL") {
      return "functional_failure";
    }
  }

  return "inconclusive";
}
export function canCorrect({ classification, active, consumed, fresh = true }) {
  return classification === "functional_failure" && active && fresh && consumed < 3;
}
export function resolveQaClassification({ classification, sourceExecutionId, latestExecutionId, active }) {
  if (!sourceExecutionId || sourceExecutionId !== latestExecutionId) return { classification: "stale", reason: "Existe una ejecucion de desarrollo mas reciente" };
  if (!active) return { classification: "inconclusive", reason: "Ciclo detenido por el usuario" };
  return { classification };
}
export function correctionOutcome(changed) {
  return { consumed: changed ? 1 : 0, classification: changed ? null : "inconclusive", stop: !changed };
}
export function classifyCommandFailure(result, changedPaths) {
  if (result.technicalError || /npm ci|dependencies/.test(result.script) || /ENOENT|ETIMEDOUT|ENOTFOUND|EACCES|ENOMEM|timed? ?out|Cannot find (?:module|package)|EAI_AGAIN|network|not recognized|command not found/i.test(result.output)) return "technical_error";
  // Require a concrete diagnostic naming a modified source file. Ambiguity never spends a correction.
  return changedPaths.some(file => {
    const normalized = file.replaceAll("\\", "/");
    return result.output.replaceAll("\\", "/").includes(normalized) ||
      result.output.replaceAll("\\", "/").includes(normalized.split("/").slice(1).join("/")) && normalized.includes("/");
  }) ? "functional_failure" : "inconclusive";
}
export function isText(content) {
  return !content.includes(0) && !new TextDecoder("utf-8", { fatal: false }).decode(content).includes("\uFFFD") &&
    !/[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(content.toString("utf8"));
}
export function reviewChunks(diff, limit = 60000) {
  const chunks = [];
  for (const file of diff.split(/(?=^diff --git )/m).filter(Boolean)) {
    // Split even a single huge file; all segments are reviewed, never truncated.
    for (let start = 0; start < file.length; start += limit) {
      const segment = file.slice(start, start + limit);
      if (chunks.length && chunks.at(-1).length + segment.length <= limit) chunks[chunks.length - 1] += segment;
      else chunks.push(segment);
    }
  }
  return chunks;
}
export async function worktreeFingerprint(root) {
  const { stdout } = await exec("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  return fingerprintFiles(root, stdout.split("\0").filter(Boolean));
}
export async function fingerprintFiles(root, files, readFile = fs.readFile) {
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    if (file.split("/").some(part => part.toLowerCase().startsWith(".env"))) continue;
    hash.update(file);
    try { hash.update(await readFile(path.join(root, file))); }
    catch (error) { if (error.code === "ENOENT") hash.update("deleted"); else throw error; }
  }
  return hash.digest("hex");
}
