import {
  execFile,
  spawn,
} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { executeCodex } from "./codex.service.js";

const execFileAsync = promisify(execFile);

const MAX_COMMAND_TIME = 5 * 60 * 1000;
const MAX_COMMAND_BUFFER = 10 * 1024 * 1024;
const NODE_SYNTAX_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
]);
const EXCLUDED_CHECK_DIRECTORIES = new Set([
  "node_modules",
  "dist",
]);
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
        maxBuffer: MAX_COMMAND_BUFFER,
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

async function executeNpmCi(workingDirectory) {
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
        "npm.cmd ci",
      ],
      {
        cwd: workingDirectory,
        windowsHide: true,
        timeout: MAX_COMMAND_TIME,
        maxBuffer: MAX_COMMAND_BUFFER,
      }
    );

    return {
      script: "npm ci",
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
      script: "npm ci",
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

async function collectNodeSyntaxFiles(
  directory
) {
  const entries = await fs.readdir(directory, {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(
      directory,
      entry.name
    );

    if (entry.isDirectory()) {
      if (
        EXCLUDED_CHECK_DIRECTORIES.has(
          entry.name
        )
      ) {
        continue;
      }

      files.push(
        ...(await collectNodeSyntaxFiles(
          entryPath
        ))
      );
      continue;
    }

    if (
      entry.isFile() &&
      NODE_SYNTAX_EXTENSIONS.has(
        path.extname(entry.name)
      )
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

function runNodeCheck(filePath, cwd) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--check", filePath],
      {
        cwd,
        shell: false,
        windowsHide: true,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      resolve({
        status: "failed",
        output: error.message,
      });
    });

    child.on("close", (code) => {
      const output = [stdout, stderr]
        .filter(Boolean)
        .join("\n")
        .trim();

      resolve({
        status:
          code === 0 ? "passed" : "failed",
        output,
      });
    });
  });
}

async function executeNodeSyntaxCheck(
  workingDirectory
) {
  const srcPath = path.join(
    workingDirectory,
    "src"
  );

  if (!(await pathExists(srcPath))) {
    return {
      script: "node --check",
      status: "passed",
      output: "NODE_SYNTAX_CHECK: PASSED",
    };
  }

  const files =
    await collectNodeSyntaxFiles(srcPath);

  for (const file of files) {
    const result = await runNodeCheck(
      file,
      workingDirectory
    );

    if (result.status === "failed") {
      const relativeFile = path.relative(
        workingDirectory,
        file
      );

      return {
        script: "node --check",
        status: "failed",
        output: [
          `Archivo: ${relativeFile}`,
          result.output,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
  }

  return {
    script: "node --check",
    status: "passed",
    output: "NODE_SYNTAX_CHECK: PASSED",
  };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function ensureDependencies(
  workingDirectory
) {
  const nodeModulesPath = path.join(
    workingDirectory,
    "node_modules"
  );
  const packageLockPath = path.join(
    workingDirectory,
    "package-lock.json"
  );

  if (await pathExists(packageLockPath)) {
    return executeNpmCi(workingDirectory);
  }

  if (await pathExists(nodeModulesPath)) {
    return null;
  }

  return {
    script: "dependencies",
    status: "failed",
    output:
      "QA no puede preparar dependencias: no existe package-lock.json para ejecutar npm ci ni node_modules para continuar sin instalar.",
  };
}

async function hasInstalledDependencies(
  workingDirectory
) {
  return pathExists(
    path.join(workingDirectory, "node_modules")
  );
}

function formatCommandLabel(script) {
  if (script === "node --check") {
    return "node --check src";
  }

  if (script === "npm ci") {
    return "npm ci";
  }

  if (script === "dependencies") {
    return "preparar dependencias";
  }

  return `npm run ${script}`;
}

function isPlaceholderTest(scriptValue) {
  return (
    scriptValue?.trim() ===
    'echo "Error: no test specified" && exit 1'
  );
}

async function runGit(args, cwd) {
  const result = await execFileAsync(
    "git",
    args,
    {
      cwd,
      windowsHide: true,
      timeout: MAX_COMMAND_TIME,
      maxBuffer: MAX_COMMAND_BUFFER,
    }
  );

  return result.stdout.trim();
}

async function getBaseWorkingDirectory(
  workingDirectory
) {
  const worktreeRoot = await runGit(
    ["rev-parse", "--show-toplevel"],
    workingDirectory
  );
  const gitCommonDirectory = await runGit(
    [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ],
    workingDirectory
  );
  const repositoryRoot = path.dirname(
    gitCommonDirectory
  );
  const relativeWorkingDirectory =
    path.relative(
      worktreeRoot,
      workingDirectory
    );

  if (
    relativeWorkingDirectory.startsWith("..")
  ) {
    throw new Error(
      "QA no pudo calcular la carpeta equivalente en la rama base"
    );
  }

  return validateDirectory(
    path.join(
      repositoryRoot,
      relativeWorkingDirectory
    )
  );
}

function countLintErrors(output) {
  const eslintSummaryMatch = output.match(
    /(\d+)\s+errors?(?:\s+and\s+\d+\s+warnings?)?/i
  );

  if (eslintSummaryMatch) {
    return Number(eslintSummaryMatch[1]);
  }

  return output
    .split(/\r?\n/)
    .filter((line) =>
      /\serror\s/i.test(line)
    ).length;
}

async function executeLintWithBaseline({
  workingDirectory,
  baseBranch,
}) {
  const lintResult = await executeNpmScript({
    script: "lint",
    workingDirectory,
  });

  if (lintResult.status === "passed") {
    return lintResult;
  }

  const baseWorkingDirectory =
    await getBaseWorkingDirectory(
      workingDirectory
    );

  if (
    !(await hasInstalledDependencies(
      baseWorkingDirectory
    ))
  ) {
    return {
      script: "lint",
      status: "failed",
      output: [
        "QA fallÃ³ al preparar la carpeta equivalente de la rama base para comparar lint.",
        "QA no puede obtener la linea base de lint porque la carpeta equivalente de la rama base no tiene node_modules.",
        "No se ejecuta npm ci en la rama base para no modificar node_modules.",
        "",
        "=== WORKTREE LINT ===",
        lintResult.output,
      ].join("\n"),
    };
  }

  const baseLintResult =
    await executeNpmScript({
      script: "lint",
      workingDirectory:
        baseWorkingDirectory,
    });

  if (baseLintResult.status !== "failed") {
    return lintResult;
  }

  const worktreeErrors = countLintErrors(
    lintResult.output
  );
  const baseErrors = countLintErrors(
    baseLintResult.output
  );

  if (worktreeErrors <= baseErrors) {
    return {
      script: "lint",
      status: "warning",
      output: [
        "QA_BASELINE_WARNING",
        `npm run lint fallÃ³ en ${baseBranch} y en el worktree, pero el worktree no agrega errores.`,
        `Errores worktree: ${worktreeErrors}`,
        `Errores ${baseBranch}: ${baseErrors}`,
        "",
        "=== WORKTREE LINT ===",
        lintResult.output,
        "",
        `=== ${baseBranch} LINT ===`,
        baseLintResult.output,
      ].join("\n"),
    };
  }

  return {
    script: "lint",
    status: "failed",
    output: [
      `npm run lint agrega errores frente a ${baseBranch}.`,
      `Errores worktree: ${worktreeErrors}`,
      `Errores ${baseBranch}: ${baseErrors}`,
      "",
      "=== WORKTREE LINT ===",
      lintResult.output,
      "",
      `=== ${baseBranch} LINT ===`,
      baseLintResult.output,
    ].join("\n"),
  };
}

async function getGitChanges(
  workingDirectory
) {
  /*
   * Hace visibles en git diff también los archivos
   * nuevos, sin agregarlos realmente al commit.
   */
  await execFileAsync(
    "git",
    [
      "add",
      "--intent-to-add",
      "--",
      ".",
    ],
    {
        cwd: workingDirectory,
        windowsHide: true,
        timeout: MAX_COMMAND_TIME,
        maxBuffer: MAX_COMMAND_BUFFER,
      }
  );

  const [statusResult, diffResult] =
    await Promise.all([
      execFileAsync(
        "git",
        ["status", "--short"],
        {
          cwd: workingDirectory,
          windowsHide: true,
          timeout: MAX_COMMAND_TIME,
          maxBuffer: MAX_COMMAND_BUFFER,
        }
      ),

      execFileAsync(
        "git",
        [
          "diff",
          "--no-ext-diff",
          "--unified=60",
          "--",
          ".",
        ],
        {
          cwd: workingDirectory,
          windowsHide: true,
          timeout: MAX_COMMAND_TIME,
          maxBuffer: MAX_COMMAND_BUFFER,
        }
      ),
    ]);

  const status = statusResult.stdout.trim();
  const diff = diffResult.stdout.trim();

  if (!diff) {
    throw new Error(
      "QA no encontró cambios para revisar"
    );
  }

  const MAX_DIFF_SIZE = 120000;

  if (diff.length > MAX_DIFF_SIZE) {
    throw new Error(
      `El diff es demasiado grande para una sola revisión QA: ${diff.length} caracteres`
    );
  }

  return {
    status,
    diff,
  };
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
  baseBranch = "main",
  taskTitle,
  taskDescription,
  correctionFeedback,
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
    (script) =>
      availableScripts[script] &&
      !(
        script === "test" &&
        isPlaceholderTest(
          availableScripts[script]
        )
      )
  );

  const results = [];
  const usingNodeSyntaxCheck =
    scriptsToRun.length === 0;

  if (usingNodeSyntaxCheck) {
    results.push(
      await executeNodeSyntaxCheck(
        safeDirectory
      )
    );
  } else {
    const dependenciesResult =
      await ensureDependencies(
        safeDirectory
      );

    if (dependenciesResult) {
      results.push(dependenciesResult);

      if (
        dependenciesResult.status ===
        "failed"
      ) {
        const commandsSummary = results
          .map(
            (result) =>
              [
                `=== ${formatCommandLabel(result.script)} ===`,
                `RESULTADO: ${result.status.toUpperCase()}`,
                result.output,
              ].join("\n")
          )
          .join("\n\n");

        return {
          status: "failed",
          summary: commandsSummary,
          results,
        };
      }
    }
  }

  if (!usingNodeSyntaxCheck) {
    for (const script of scriptsToRun) {
      const result =
        script === "lint"
          ? await executeLintWithBaseline({
              workingDirectory:
                safeDirectory,
              baseBranch,
            })
          : await executeNpmScript({
              script,
              workingDirectory:
                safeDirectory,
            });

      results.push(result);

      if (result.status === "failed") {
        break;
      }
    }
  }

  const commandsPassed = results.every(
    (result) =>
      result.status === "passed" ||
      result.status === "warning"
  );

  const commandsSummary = results
    .map(
      (result) =>
        [
          `=== ${formatCommandLabel(result.script)} ===`,
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

  const validationsMessage =
    usingNodeSyntaxCheck
      ? "Considerá que node --check ya finalizó correctamente."
      : "Considerá que lint y build ya finalizaron correctamente.";

  const gitChanges =
  await getGitChanges(safeDirectory);

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

OBSERVACIONES HUMANAS POSTERIORES:
${
  correctionFeedback ||
  "No existen observaciones posteriores."
}

IMPORTANTE:
Si las observaciones humanas posteriores contradicen el requerimiento original, las observaciones posteriores tienen prioridad porque representan la decisión más reciente del revisor.

INSTRUCCIONES:
- Revisá exclusivamente el STATUS y DIFF entregados dentro de este mensaje.
- No intentes ejecutar git diff.
- Podés leer archivos del proyecto solamente si necesitás contexto adicional.
- No modifiques archivos.
- No hagas commit, push, merge ni deploy.
- Buscá errores lógicos, regresiones, problemas de seguridad y criterios incumplidos.
- ${validationsMessage}
- No rechaces por preferencias estéticas menores.
- Si encontrás un problema real, emití QA_FAIL.
- Si no encontrás problemas bloqueantes, emití QA_PASS.

STATUS DE GIT:
${gitChanges.status}

DIFF EXACTO DE LA TAREA:
\`\`\`diff
${gitChanges.diff}
\`\`\`

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
