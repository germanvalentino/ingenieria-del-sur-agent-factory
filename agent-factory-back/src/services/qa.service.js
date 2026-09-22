import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { executeCodex } from "./codex.service.js";

const execFileAsync = promisify(execFile);

const MAX_COMMAND_TIME = 5 * 60 * 1000;
const ALLOWED_ROOT = path.resolve(
  "C:/proyectos"
);

function validateDirectory(directory) {
  const resolved = path.resolve(directory);

  if (
    resolved !== ALLOWED_ROOT &&
    !resolved.startsWith(
      `${ALLOWED_ROOT}${path.sep}`
    )
  ) {
    throw new Error(
      "QA recibió una ruta fuera de C:/proyectos"
    );
  }

  return resolved;
}

async function executeNpmScript({
  script,
  workingDirectory,
}) {
  try {
    const commandProcessor =
      process.env.ComSpec ||
      "C:\\Windows\\System32\\cmd.exe";

    const result = await execFileAsync(
      commandProcessor,
      [
        "/d",
        "/s",
        "/c",
        `npm.cmd run ${script}`,
      ],
      {
        cwd: workingDirectory,
        windowsHide: true,
        timeout: MAX_COMMAND_TIME,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    return {
      script,
      status: "passed",
      output: [
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n")
        .trim(),
    };
  } catch (error) {
    return {
      script,
      status: "failed",
      output: [
        error.stdout,
        error.stderr,
        error.message,
      ]
        .filter(Boolean)
        .join("\n")
        .trim(),
    };
  }
}

function parseQaVerdict(output) {
  const matches = [
    ...output.matchAll(
      /\bQA_(PASS|FAIL)\b/g
    ),
  ];

  if (matches.length === 0) {
    return {
      status: "failed",
      reason:
        "Codex no emitió QA_PASS o QA_FAIL",
    };
  }

  const lastVerdict =
    matches[matches.length - 1][1];

  return {
    status:
      lastVerdict === "PASS"
        ? "passed"
        : "failed",
    reason: null,
  };
}

export async function runQaValidation({
  workingDirectory,
  taskTitle,
  taskDescription,
}) {
  const safeDirectory =
    validateDirectory(workingDirectory);

  const packageJsonPath = path.join(
    safeDirectory,
    "package.json"
  );

  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, "utf8")
  );

  const availableScripts =
    packageJson.scripts || {};

  const scriptsToRun = [
    "lint",
    "test",
    "build",
  ].filter(
    (script) => availableScripts[script]
  );

  if (scriptsToRun.length === 0) {
    throw new Error(
      "El proyecto no tiene scripts lint, test o build"
    );
  }

  const results = [];

  for (const script of scriptsToRun) {
    const result = await executeNpmScript({
      script,
      workingDirectory: safeDirectory,
    });

    results.push(result);

    if (result.status === "failed") {
      break;
    }
  }

  const commandsPassed = results.every(
    (result) =>
      result.status === "passed"
  );

  const commandsSummary = results
    .map(
      (result) =>
        [
          `=== npm run ${result.script} ===`,
          `RESULTADO: ${result.status.toUpperCase()}`,
          result.output,
        ].join("\n")
    )
    .join("\n\n");

  if (!commandsPassed) {
    return {
      status: "failed",
      summary: commandsSummary,
      results,
    };
  }

  const reviewPrompt = `
Sos el QA Agent de Ingeniería del Sur.

Tu trabajo es revisar los cambios sin modificar ningún archivo.

TAREA ORIGINAL:
${taskTitle}

DESCRIPCIÓN:
${
  taskDescription ||
  "Sin descripción adicional."
}

INSTRUCCIONES:
- Revisá únicamente los cambios actuales mostrados por git diff.
- No modifiques archivos.
- No hagas commit, push, merge ni deploy.
- Buscá errores lógicos, regresiones, problemas de seguridad y criterios incumplidos.
- Considerá que lint y build ya finalizaron correctamente.
- No rechaces por preferencias estéticas menores.
- Si encontrás un problema real, emití QA_FAIL.
- Si no encontrás problemas bloqueantes, emití QA_PASS.

FORMATO OBLIGATORIO:
La primera línea de tu respuesta debe ser exactamente QA_PASS o QA_FAIL.

Después incluí:
RESUMEN:
HALLAZGOS:
RIESGOS:
`;

  const codexReview =
    await executeCodex({
      workingDirectory: safeDirectory,
      prompt: reviewPrompt,
      sandbox: "read-only",
    });

  const verdict = parseQaVerdict(
    codexReview.output
  );

  const summary = [
    commandsSummary,
    "",
    "=== REVISIÓN DE CÓDIGO CODEX ===",
    codexReview.output,
  ].join("\n");

  return {
    status: verdict.status,
    summary,
    results,
    review: codexReview.output,
  };
}