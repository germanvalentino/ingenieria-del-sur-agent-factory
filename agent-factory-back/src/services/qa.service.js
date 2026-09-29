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
}) {
  const afterStatus =
    await getGitStatusSnapshot(
      workingDirectory
    );

  if (afterStatus !== beforeStatus) {
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

function shouldIncludeReviewFile(gitPath) {
  const normalized = normalizeGitPath(gitPath);
  const parts = normalized.split("/");
  const filename =
    parts.at(-1)?.toLowerCase() || "";

  if (
    EXCLUDED_REVIEW_FILENAMES.has(filename) ||
    filename.startsWith(".env.")
  ) {
    return false;
  }

  if (
    EXCLUDED_REVIEW_EXTENSIONS.has(
      path.extname(filename)
    )
  ) {
    return false;
  }

  return !parts.some((part) =>
    EXCLUDED_REVIEW_DIRECTORIES.has(
      part.toLowerCase()
    )
  );
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

  return runGit(
    [
      "diff",
      ...(cached ? ["--cached"] : []),
      "--no-ext-diff",
      "--unified=60",
      "--",
      ...reviewablePaths,
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
  remainingSize,
}) {
  const diffs = [];
  let usedSize = 0;

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

    const content = await fs.readFile(
      absolutePath,
      "utf8"
    );
    const diff = formatAddedFileDiff({
      gitPath,
      content,
    });

    usedSize += diff.length;

    if (usedSize > remainingSize) {
      throw new Error(
        `El diff es demasiado grande para una sola revisiÃ³n QA: supera ${remainingSize} caracteres al incorporar archivos nuevos`
      );
    }

    diffs.push(diff);
  }

  return diffs.join("\n\n");
}

async function getGitChanges(
  workingDirectory
) {
  /*
   * Hace visibles en git diff también los archivos
   * nuevos, sin agregarlos realmente al commit.
   */
  const MAX_DIFF_SIZE = 120000;
  const repositoryRoot = validateDirectory(
    await runGit(
      ["rev-parse", "--show-toplevel"],
      workingDirectory
    )
  );
  const [
    status,
    unstagedPathsResult,
    stagedPathsResult,
    untrackedResult,
  ] =
    await Promise.all([
      getGitStatusSnapshot(
        repositoryRoot
      ),
      runGit(
        [
          "diff",
          "--name-only",
          "--",
        ],
        repositoryRoot
      ),
      runGit(
        [
          "diff",
          "--cached",
          "--name-only",
          "--",
        ],
        repositoryRoot
      ),
      runGit(
        [
          "ls-files",
          "--others",
          "--exclude-standard",
        ],
        repositoryRoot
      ),
    ]);

  const unstagedDiff = await getReviewDiff({
    workingDirectory: repositoryRoot,
    cached: false,
    paths: unstagedPathsResult.split(/\r?\n/),
  });
  const stagedDiff = await getReviewDiff({
    workingDirectory: repositoryRoot,
    cached: true,
    paths: stagedPathsResult.split(/\r?\n/),
  });
  const trackedDiff = [
    unstagedDiff,
    stagedDiff,
  ]
    .filter(Boolean)
    .join("\n\n");
  const untrackedDiff =
    await buildUntrackedFilesDiff({
      workingDirectory: repositoryRoot,
      untrackedPaths: getReviewableGitPaths(
        untrackedResult.split(/\r?\n/)
      ),
      remainingSize:
        MAX_DIFF_SIZE - trackedDiff.length,
    });
  const diff = [trackedDiff, untrackedDiff]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!diff) {
    throw new Error(
      "QA no encontró cambios para revisar"
    );
  }

  if (diff.length > MAX_DIFF_SIZE) {
    throw new Error(
      `El diff es demasiado grande para una sola revisión QA: ${diff.length} caracteres`
    );
  }

  return {
    status: sanitizeGitStatus(status),
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
}) {
  const safeDirectory =
    validateDirectory(workingDirectory);
  const initialGitStatus =
    await getGitStatusSnapshot(
      safeDirectory
    );

  let results = [];
  let usingNodeSyntaxCheck = false;
  let commandsSummary;

  if (projectDirectories?.length) {
    const changedPaths = await getGitChangedPaths(
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
        await runProjectValidations({
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
      await runProjectValidations({
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
    await assertGitStatusUnchanged({
      workingDirectory: safeDirectory,
      beforeStatus: initialGitStatus,
    });

    return {
      status: "failed",
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

  const agentReview =
    await executeAgent({
      provider,
      workingDirectory: safeDirectory,
      prompt: reviewPrompt,
      sandbox: "read-only",
    });

  const verdict = parseQaVerdict(
    agentReview.output
  );

  const summary = [
    commandsSummary,
    "",
    `=== REVISION DE CODIGO ${provider.toUpperCase()} ===`,
    agentReview.output,
  ].join("\n");

  await assertGitStatusUnchanged({
    workingDirectory: safeDirectory,
    beforeStatus: initialGitStatus,
  });

  return {
    status: verdict.status,
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
