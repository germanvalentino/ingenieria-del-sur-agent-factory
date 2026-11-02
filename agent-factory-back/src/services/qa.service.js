import { collectExecutionDiff, buildSelectiveContext, qaContextChunks, includeContextFile, contextLimits, contextError } from "./selective-context.service.js";
import { redactSecrets } from "./secret-redaction.service.js";
import { classifyVerdict, classifyCommandFailure, isText, reviewChunks, worktreeFingerprint } from "./qa-cycle.service.js";
import {
  execFile,
  spawn,
} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { executeAgent } from "./agent-runner.service.js";

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
  "build",
  ".git",
]);
const EXCLUDED_REVIEW_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
]);
const EXCLUDED_REVIEW_FILENAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
]);
const EXCLUDED_REVIEW_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
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
      technicalError: Boolean(error.killed || error.signal || typeof error.code !== "number"),
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
      technicalError: Boolean(error.killed || error.signal || typeof error.code !== "number"),
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
        technicalError: true,
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
        technicalError: result.technicalError,
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

  if (await pathExists(nodeModulesPath)) return null;

  if (await pathExists(packageLockPath)) {
    return executeNpmCi(workingDirectory);
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

function normalizeGitPath(gitPath) {
  return gitPath.replace(/\\/g, "/");
}

function uniqueGitPaths(paths) {
  return [
    ...new Set(
      paths
        .map((filePath) =>
          normalizeGitPath(filePath).trim()
        )
        .filter(Boolean)
    ),
  ];
}

function normalizeComparablePath(directory) {
  const resolved = path.resolve(directory);
  const normalized = normalizeGitPath(resolved);

  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

async function getGitStatusSnapshot(
  workingDirectory
) {
  return runGit(
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ],
    workingDirectory
  );
}

async function assertGitStatusUnchanged({
  workingDirectory,
  beforeStatus,
  beforeFingerprint,
}) {
  const afterStatus =
    await getGitStatusSnapshot(
      workingDirectory
    );

  if (afterStatus !== beforeStatus || (beforeFingerprint && beforeFingerprint !== await worktreeFingerprint(workingDirectory))) {
    throw new Error(
      [
        "QA modificÃ³ el estado Git del worktree durante la validaciÃ³n.",
        "QA no debe alterar archivos staged ni unstaged.",
        "",
        "=== STATUS ANTES ===",
        sanitizeGitStatus(beforeStatus) ||
          "(sin cambios visibles)",
        "",
        "=== STATUS DESPUÃ‰S ===",
        sanitizeGitStatus(afterStatus) ||
          "(sin cambios visibles)",
      ].join("\n")
    );
  }
}

async function getGitChangedPaths(
  workingDirectory
) {
  const [
    unstagedResult,
    stagedResult,
    untrackedResult,
  ] = await Promise.all([
    runGit(
      ["diff", "--name-only", "--"],
      workingDirectory
    ),
    runGit(
      [
        "diff",
        "--cached",
        "--name-only",
        "--",
      ],
      workingDirectory
    ),
    runGit(
      [
        "ls-files",
        "--others",
        "--exclude-standard",
      ],
      workingDirectory
    ),
  ]);

  return uniqueGitPaths(
    [
      unstagedResult,
      stagedResult,
      untrackedResult,
    ].flatMap((output) =>
      output.split(/\r?\n/)
    )
  );
}

function projectHasChanges({
  changedPaths,
  worktreeRoot,
  projectDirectory,
}) {
  const relativeProjectPath = path.relative(
    worktreeRoot,
    projectDirectory
  );
  const relativeProjectDirectory =
    normalizeGitPath(relativeProjectPath);

  if (
    relativeProjectDirectory === ".." ||
    relativeProjectDirectory.startsWith("../") ||
    path.isAbsolute(relativeProjectPath)
  ) {
    return false;
  }

  const isProjectRoot =
    relativeProjectDirectory === "" ||
    relativeProjectDirectory === ".";

  if (isProjectRoot) {
    return changedPaths.length > 0;
  }

  return changedPaths.some(
    (changedPath) =>
      changedPath === relativeProjectDirectory ||
      changedPath.startsWith(
        `${relativeProjectDirectory}/`
      )
  );
}

async function validateFullstackProjectDirectory({
  label,
  directory,
  worktreeRoot,
}) {
  if (!directory?.trim()) {
    throw new Error(
      `QA fullstack requiere ruta ${label}`
    );
  }

  const trimmedDirectory = directory.trim();

  if (!path.isAbsolute(trimmedDirectory)) {
    throw new Error(
      `QA fullstack requiere una ruta absoluta para ${label}`
    );
  }

  const safeDirectory =
    validateDirectory(trimmedDirectory);
  const relativeDirectory = path.relative(
    worktreeRoot,
    safeDirectory
  );

  if (
    relativeDirectory === ".." ||
    relativeDirectory.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeDirectory)
  ) {
    throw new Error(
      `QA fullstack recibiÃ³ una ruta ${label} fuera del worktree`
    );
  }

  try {
    await fs.access(safeDirectory);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `QA fullstack recibiÃ³ una ruta ${label} inexistente: ${safeDirectory}`
      );
    }

    throw error;
  }

  return {
    label,
    directory: safeDirectory,
  };
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
}) {
  return executeNpmScript({
    script: "lint",
    workingDirectory,
  });
}

export function shouldIncludeReviewFile(gitPath) {
  return includeContextFile(gitPath);
}

function getReviewableGitPaths(paths) {
  return uniqueGitPaths(paths).filter(
    shouldIncludeReviewFile
  );
}

function sanitizeGitStatus(status) {
  return status
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => {
      const rawPath = line.slice(3).trim();
      const paths = rawPath
        .split(" -> ")
        .map((item) =>
          item.replace(/^"|"$/g, "")
        );

      return paths.every(
        shouldIncludeReviewFile
      );
    })
    .join("\n");
}

async function getReviewDiff({
  workingDirectory,
  cached,
  paths,
}) {
  const reviewablePaths =
    getReviewableGitPaths(paths);

  if (reviewablePaths.length === 0) {
    return "";
  }

  const textPaths = [];
  for (const file of reviewablePaths) {
    try { if (isText(await fs.readFile(path.join(workingDirectory, file)))) textPaths.push(file); }
    catch (error) { if (error.code === "ENOENT") textPaths.push(file); else throw error; }
  }
  if (!textPaths.length) return "";
  return runGit(
    [
      "diff",
      ...(cached ? ["--cached"] : []),
      "--no-ext-diff",
      "--unified=60",
      "--",
      ...textPaths,
    ],
    workingDirectory
  );
}

function formatAddedFileDiff({
  gitPath,
  content,
}) {
  const normalizedPath =
    normalizeGitPath(gitPath);
  const lines = content.split(/\r?\n/);

  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${normalizedPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

async function buildUntrackedFilesDiff({
  workingDirectory,
  untrackedPaths,
}) {
  const diffs = [];

  for (const gitPath of untrackedPaths) {
    if (!shouldIncludeReviewFile(gitPath)) {
      continue;
    }

    const absolutePath = path.join(
      workingDirectory,
      gitPath
    );
    const stat = await fs.stat(absolutePath);

    if (!stat.isFile()) {
      continue;
    }

    const bytes = await fs.readFile(absolutePath);
    if (!isText(bytes)) continue;
    const content = bytes.toString("utf8");
    const diff = formatAddedFileDiff({
      gitPath,
      content,
    });

    diffs.push(diff);
  }

  return diffs.join("\n\n");
}



async function runProjectValidations({
  workingDirectory,
  baseBranch,
}) {
  const packageJsonPath = path.join(
    workingDirectory,
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
        workingDirectory
      )
    );
  } else {
    const dependenciesResult =
      await ensureDependencies(
        workingDirectory
      );

    if (dependenciesResult) {
      results.push(dependenciesResult);

      if (
        dependenciesResult.status ===
        "failed"
      ) {
        return {
          results,
          usingNodeSyntaxCheck,
        };
      }
    }
  }

  if (!usingNodeSyntaxCheck) {
    for (const script of scriptsToRun) {
      const result =
        script === "lint"
          ? await executeLintWithBaseline({
              workingDirectory,
              baseBranch,
            })
          : await executeNpmScript({
              script,
              workingDirectory,
            });

      results.push(result);

      if (result.status === "failed") {
        break;
      }
    }
  }

  return {
    results,
    usingNodeSyntaxCheck,
  };
}

function formatResultsSummary(results) {
  return results
    .map(
      (result) =>
        [
          `=== ${formatCommandLabel(result.script)} ===`,
          `RESULTADO: ${result.status.toUpperCase()}`,
          result.output,
        ].join("\n")
    )
    .join("\n\n");
}

function prefixProjectResults({
  label,
  results,
}) {
  return results.map((result) => ({
    ...result,
    project: label,
    script: `${label} ${result.script}`,
  }));
}

async function dedupeValidationProjects(projects) {
  const projectsByDirectory = new Map();

  for (const project of projects) {
    const realDirectory = await fs.realpath(
      project.directory
    );
    const directoryKey =
      normalizeComparablePath(realDirectory);
    const existing =
      projectsByDirectory.get(directoryKey);

    if (existing) {
      existing.labels.push(project.label);
      continue;
    }

    projectsByDirectory.set(directoryKey, {
      labels: [project.label],
      directory: realDirectory,
    });
  }

  return [...projectsByDirectory.values()].map(
    (project) => ({
      label:
        project.labels.includes("FRONTEND") &&
        project.labels.includes("BACKEND")
          ? "FULLSTACK"
          : project.labels[0],
      directory: project.directory,
    })
  );
}

function formatProjectResultsSummary({
  label,
  results,
}) {
  return results
    .map(
      (result) =>
        [
          `=== ${label}: ${formatCommandLabel(result.script)} ===`,
          `RESULTADO: ${result.status.toUpperCase()}`,
          result.output,
        ].join("\n")
    )
    .join("\n\n");
}

export async function runQaValidation({
  workingDirectory,
  projectDirectories = null,
  baseBranch = "main",
  provider = "codex",
  taskTitle,
  taskDescription,
  correctionFeedback,
  shouldContinue = async () => true,
  dependencies = {},
}) {
  const started = Date.now();
  const validateProject = dependencies.validateProject || runProjectValidations;
  const readStatus = dependencies.readStatus || getGitStatusSnapshot;
  const changedFiles = dependencies.changedFiles || getGitChangedPaths;
  const readChanges = dependencies.readChanges || collectExecutionDiff;
  const review = dependencies.review || executeAgent;
  const assertUnchanged = dependencies.assertUnchanged || assertGitStatusUnchanged;
  const fingerprint = dependencies.fingerprint || worktreeFingerprint;
  const safeDirectory = validateDirectory(workingDirectory);
  const initialGitStatus =
    await readStatus(
      safeDirectory
    );

  const initialFingerprint = await fingerprint(safeDirectory);
  let results = [];
  let usingNodeSyntaxCheck = false;
  let commandsSummary;

  if (projectDirectories?.length) {
    const changedPaths = await changedFiles(
      safeDirectory
    );
    const frontendProject =
      projectDirectories.find(
        (project) =>
          project.label === "FRONTEND"
      );
    const backendProject =
      projectDirectories.find(
        (project) =>
          project.label === "BACKEND"
      );

    if (
      !frontendProject ||
      !backendProject
    ) {
      throw new Error(
        "QA fullstack requiere rutas FRONTEND y BACKEND"
      );
    }

    const projects = await Promise.all([
      validateFullstackProjectDirectory({
        label: "FRONTEND",
        directory:
          frontendProject.directory,
        worktreeRoot: safeDirectory,
      }),
      validateFullstackProjectDirectory({
        label: "BACKEND",
        directory:
          backendProject.directory,
        worktreeRoot: safeDirectory,
      }),
    ]);
    const validationProjects =
      await dedupeValidationProjects(projects);
    const directlyChangedProjects =
      validationProjects.filter((project) =>
        projectHasChanges({
          changedPaths,
          worktreeRoot: safeDirectory,
          projectDirectory: project.directory,
        })
      );

    const hasSharedRootChanges =
      changedPaths.some(
        (changedPath) =>
          !validationProjects.some((project) =>
            projectHasChanges({
              changedPaths: [changedPath],
              worktreeRoot: safeDirectory,
              projectDirectory:
                project.directory,
            })
          )
      );

    const changedProjects =
      hasSharedRootChanges
        ? validationProjects
        : directlyChangedProjects;

    if (changedProjects.length === 0) {
      throw new Error(
        "QA no encontrÃ³ cambios en FRONTEND ni BACKEND"
      );
    }

    const projectSummaries = [];

    for (const project of changedProjects) {
      const projectValidation =
        await validateProject({
          workingDirectory:
            project.directory,
          baseBranch,
        });

      usingNodeSyntaxCheck =
        usingNodeSyntaxCheck ||
        projectValidation.usingNodeSyntaxCheck;
      results.push(
        ...prefixProjectResults({
          label: project.label,
          results:
            projectValidation.results,
        })
      );
      projectSummaries.push(
        formatProjectResultsSummary({
          label: project.label,
          results:
            projectValidation.results,
        })
      );

    }

    commandsSummary =
      projectSummaries.join("\n\n");
  } else {
    const projectValidation =
      await validateProject({
        workingDirectory: safeDirectory,
        baseBranch,
      });

    results = projectValidation.results;
    usingNodeSyntaxCheck =
      projectValidation.usingNodeSyntaxCheck;
    commandsSummary =
      formatResultsSummary(results);
  }

  const commandsPassed = results.every(
    (result) =>
      result.status === "passed" ||
      result.status === "warning"
  );

  if (!commandsPassed) {
    await assertUnchanged({
      workingDirectory: safeDirectory,
      beforeStatus: initialGitStatus,
      beforeFingerprint: initialFingerprint,
    });

    return {
      status: "failed",
      contextMetrics: { characters: 0, includedFiles: [], excludedFiles: [], blocksReviewed: 0 },
      durationMs: Date.now() - started,
      classification: classifyCommandFailure(results.find(r => r.status === "failed"), await changedFiles(safeDirectory)),
      reason: commandsSummary,
      summary: commandsSummary,
      results,
      codexUsage: null,
      codexModel: null,
    };
  }

  const validationsMessage =
    usingNodeSyntaxCheck
      ? "Considerá que node --check ya finalizó correctamente."
      : "Considera que las validaciones configuradas ya finalizaron correctamente. No exijas node --check si el proyecto tiene scripts lint, test o build; node --check es solamente el fallback cuando no existe ninguno de esos scripts.";

  const gitChanges =
  await readChanges(safeDirectory);

  const context = await buildSelectiveContext({ root: gitChanges.root || safeDirectory, diff: gitChanges.diff, excluded: gitChanges.excluded, intentionalLocks: gitChanges.intentionalLocks });
  if (!context.diff.trim()) throw Object.assign(new Error('QA sin cambios textuales revisables'), { qaClassification: 'inconclusive', contextMetrics: context.metrics });
  if (context.metrics.excludedFiles.some(item => ['binary', 'non-regular'].includes(item.reason))) throw contextError('Contexto inseguro: cambios no revisables requieren revision adicional', context.metrics);
  const chunks = qaContextChunks(context.diff);
  const contextMetrics = { ...context.metrics, characters: 0, blocksReviewed: 0 };
  const reviews = [];
  let technicalError = null;
  const reviewPrompts = [];
  for (const chunk of chunks) {
  const relatedContext = context.dependencyFiles.filter(text => {
    const file = text.match(/^ARCHIVO (.+):\n/)?.[1];
    return !chunk.startsWith("diff --git ") || context.dependencyOwners[file]?.some(owner => chunk.includes(`b/${owner}`));
  }).join("\n\n");
  let reviewPrompt = `
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
- Este mensaje contiene un grupo de archivos o un segmento de un diff grande. Si falta contexto necesario, no emitas QA_PASS: responde INCONCLUSIVE y explica el impedimento.
- No intentes ejecutar git diff.
- Lee archivos adicionales solamente si son dependencias directas del cambio. No recorras el repositorio ni releas contenido incluido. Nunca leas .env, secretos, binarios, logs ni archivos generados.
- No modifiques archivos.
- No hagas commit, push, merge ni deploy.
- Buscá errores lógicos, regresiones, problemas de seguridad y criterios incumplidos.
- ${validationsMessage}
- No rechaces por preferencias estéticas menores.
- Emití QA_FAIL únicamente ante un defecto bloqueante, concreto y verificable en el diff que incumpla un criterio de aceptación, rompa el funcionamiento o introduzca un riesgo de seguridad real.
- Para cada hallazgo bloqueante indicá archivo o función afectada, escenario de reproducción y consecuencia observable.
- No uses QA_FAIL por riesgos hipotéticos, mejoras opcionales, refactors, cobertura de tests no exigida, diferencias de estilo o dudas sin evidencia. Esos puntos pueden quedar en RIESGOS con QA_PASS.
- No vuelvas a exigir correcciones ya resueltas ni amplíes el alcance de la tarea con requisitos nuevos.
- Si no encontrás problemas bloqueantes, emití QA_PASS.

STATUS DE GIT:
${gitChanges.status || "Ver diff"}

DIFF EXACTO DE LA TAREA:
\`\`\`diff
${chunk}
\`\`\`

DEPENDENCIAS DIRECTAS:
${relatedContext}

FORMATO OBLIGATORIO:
La primera línea de tu respuesta debe ser exactamente QA_PASS o QA_FAIL.

Después incluí:
RESUMEN:
HALLAZGOS:
RIESGOS:
`;

  reviewPrompt = redactSecrets(reviewPrompt);
  reviewPrompts.push(reviewPrompt);
  }
  if (reviewPrompts.reduce((sum, prompt) => sum + prompt.length, 0) > contextLimits().total) throw contextError("Contexto inseguro: prompts QA exceden limite total", contextMetrics);
  for (const reviewPrompt of reviewPrompts) {
  if (!await shouldContinue()) break;
  contextMetrics.characters += reviewPrompt.length;
  try {
  const agentReview =
    await review({
      provider,
      workingDirectory: safeDirectory,
      prompt: reviewPrompt,
      contextPrepared: true,
      contextMetrics,
      sandbox: "read-only",
    });

  reviews.push(agentReview);
  contextMetrics.blocksReviewed++;
  } catch (error) {
    technicalError = error.message;
    if (error.agentResult) reviews.push(error.agentResult);
    break;
  }
  }
  const classifications = reviews.map(r => classifyVerdict(r.output));
  const classification = technicalError ? "technical_error" : reviews.length !== chunks.length || chunks.length === 0 ? "inconclusive" : classifications.includes("inconclusive") ? "inconclusive" : classifications.includes("functional_failure") ? "functional_failure" : "passed";
  const agentReview = { output: reviews.map((r, i) => `Grupo ${i + 1}:\n${r.output}`).join("\n\n"), model: reviews[0]?.model, usage: {}, costUsd: null };
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens"]) {
    const values = reviews.map(r => r.usage?.[key]);
    agentReview.usage[key] = values.every(Number.isFinite) ? values.reduce((a,b) => a+b, 0) : null;
  }
  if (reviews.every(r => Number.isFinite(r.costUsd))) agentReview.costUsd = reviews.reduce((sum, r) => sum + r.costUsd, 0);
  const verdict = { status: classification === "passed" ? "passed" : "failed" };

  const summary = [
    commandsSummary,
    technicalError,
    "",
    `=== REVISION DE CODIGO ${provider.toUpperCase()} ===`,
    agentReview.output,
  ].join("\n");

  await assertUnchanged({
    workingDirectory: safeDirectory,
    beforeStatus: initialGitStatus,
    beforeFingerprint: initialFingerprint,
  });

  return {
    status: verdict.status,
    contextMetrics,
    classification,
    reason: technicalError || (classification === "inconclusive" ? "Revision incompleta, detenida o sin veredicto valido" : agentReview.output),
    durationMs: Date.now() - started,
    costUsd: agentReview.costUsd,
    groups: chunks.length,
    summary,
    results,
    review: agentReview.output,
    aiProvider: provider,
    aiUsage: agentReview.usage,
    aiModel: agentReview.model,
    codexUsage:
      provider === "codex" ? agentReview.usage : null,
    codexModel:
      provider === "codex" ? agentReview.model : null,
  };
}
