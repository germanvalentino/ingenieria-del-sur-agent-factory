import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_COMMAND_TIME = 5 * 60 * 1000;
const ALLOWED_ROOT = path.resolve("C:/proyectos");

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
    const result = await execFileAsync(
      "npm.cmd",
      ["run", script],
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

export async function runQaValidation({
  workingDirectory,
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

  const passed = results.every(
    (result) => result.status === "passed"
  );

  const summary = results
    .map(
      (result) =>
        [
          `=== npm run ${result.script} ===`,
          `RESULTADO: ${result.status.toUpperCase()}`,
          result.output,
        ].join("\n")
    )
    .join("\n\n");

  return {
    status: passed ? "passed" : "failed",
    summary,
    results,
  };
}