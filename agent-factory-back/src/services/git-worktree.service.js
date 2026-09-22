import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ALLOWED_ROOT = path.resolve("C:/proyectos");
const WORKTREES_ROOT = path.resolve(
  "C:/proyectos/.agent-worktrees"
);

async function runGit(args, cwd) {
  try {
    const result = await execFileAsync(
      "git",
      args,
      {
        cwd,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    return {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    const message =
      error.stderr?.trim() ||
      error.stdout?.trim() ||
      error.message;

    throw new Error(`Git: ${message}`);
  }
}

function validateAllowedPath(directory) {
  const resolved = path.resolve(directory);

  if (
    resolved !== ALLOWED_ROOT &&
    !resolved.startsWith(`${ALLOWED_ROOT}${path.sep}`)
  ) {
    throw new Error(
      `Ruta fuera del espacio permitido: ${resolved}`
    );
  }

  return resolved;
}

function validateBranchName(branchName) {
  const valid =
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(
      branchName
    );

  if (
    !valid ||
    branchName.includes("..") ||
    branchName.includes("@{") ||
    branchName.endsWith("/") ||
    branchName.endsWith(".")
  ) {
    throw new Error(
      `Nombre de rama inválido: ${branchName}`
    );
  }
}

export async function prepareTaskWorktree({
  taskId,
  targetDirectory,
  branchName,
  baseBranch = "main",
}) {
  const safeTargetDirectory =
    validateAllowedPath(targetDirectory);

  validateBranchName(branchName);
  validateBranchName(baseBranch);

  const repositoryResult = await runGit(
    ["rev-parse", "--show-toplevel"],
    safeTargetDirectory
  );

  const repositoryRoot = validateAllowedPath(
    repositoryResult.stdout
  );

  const statusResult = await runGit(
    ["status", "--porcelain"],
    repositoryRoot
  );

  if (statusResult.stdout) {
    throw new Error(
      "El repositorio principal tiene cambios sin guardar. Hacé commit o descartalos antes de ejecutar un agente."
    );
  }

  const relativeTarget = path.relative(
    repositoryRoot,
    safeTargetDirectory
  );

  if (relativeTarget.startsWith("..")) {
    throw new Error(
      "El directorio asignado no pertenece al repositorio"
    );
  }

  await fs.mkdir(WORKTREES_ROOT, {
    recursive: true,
  });

  const worktreeRoot = path.join(
    WORKTREES_ROOT,
    taskId
  );

  try {
    await fs.access(worktreeRoot);

    throw new Error(
      `Ya existe un worktree para la tarea: ${worktreeRoot}`
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  await runGit(
    [
      "worktree",
      "add",
      "-b",
      branchName,
      worktreeRoot,
      baseBranch,
    ],
    repositoryRoot
  );

  const agentWorkingDirectory = path.join(
    worktreeRoot,
    relativeTarget
  );

  return {
    repositoryRoot,
    worktreeRoot,
    agentWorkingDirectory,
    branchName,
    baseBranch,
  };
}

export async function getWorktreeStatus(
  worktreeRoot
) {
  const safeWorktree =
    validateAllowedPath(worktreeRoot);

  const result = await runGit(
    ["status", "--short"],
    safeWorktree
  );

  return result.stdout;
}

export async function finalizeTaskWorktree({
  worktreeRoot,
  branchName,
  baseBranch,
  commitMessage,
}) {
  const safeWorktree =
    validateAllowedPath(worktreeRoot);

  validateBranchName(branchName);
  validateBranchName(baseBranch);

  const commonDirectoryResult = await runGit(
    [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ],
    safeWorktree
  );

  const repositoryRoot = validateAllowedPath(
    path.dirname(commonDirectoryResult.stdout)
  );

  const worktreeBranchResult = await runGit(
    ["branch", "--show-current"],
    safeWorktree
  );

  if (
    worktreeBranchResult.stdout !== branchName
  ) {
    throw new Error(
      `El worktree está en la rama ${worktreeBranchResult.stdout}, no en ${branchName}`
    );
  }

  const statusResult = await runGit(
    ["status", "--porcelain"],
    safeWorktree
  );

  if (!statusResult.stdout) {
    throw new Error(
      "El agente no dejó cambios para aprobar"
    );
  }

  const mainStatusResult = await runGit(
    ["status", "--porcelain"],
    repositoryRoot
  );

  if (mainStatusResult.stdout) {
    throw new Error(
      "El repositorio principal tiene cambios sin guardar"
    );
  }

  const mainBranchResult = await runGit(
    ["branch", "--show-current"],
    repositoryRoot
  );

  if (mainBranchResult.stdout !== baseBranch) {
    throw new Error(
      `El repositorio principal debe estar en ${baseBranch}, pero está en ${mainBranchResult.stdout}`
    );
  }

  const originalHeadResult = await runGit(
    ["rev-parse", "HEAD"],
    safeWorktree
  );

  await runGit(
    ["add", "--all"],
    safeWorktree
  );

  await runGit(
    ["commit", "-m", commitMessage],
    safeWorktree
  );

  try {
    await runGit(
      ["rebase", baseBranch],
      safeWorktree
    );
  } catch (error) {
    const recoveryWarnings = [];

    try {
      await runGit(
        ["rebase", "--abort"],
        safeWorktree
      );
    } catch (abortError) {
      recoveryWarnings.push(
        `No se pudo abortar el rebase: ${abortError.message}`
      );
    }

    try {
      await runGit(
        [
          "reset",
          "--mixed",
          originalHeadResult.stdout,
        ],
        safeWorktree
      );
    } catch (resetError) {
      recoveryWarnings.push(
        `No se pudo recuperar el estado sin commit: ${resetError.message}`
      );
    }

    throw new Error(
      [
        "El rebase automático falló por conflictos. Los cambios de la tarea quedaron recuperados sin commit en el worktree.",
        error.message,
        ...recoveryWarnings,
      ].join("\n")
    );
  }

  const commitResult = await runGit(
    ["rev-parse", "HEAD"],
    safeWorktree
  );

  await runGit(
    ["merge", "--ff-only", branchName],
    repositoryRoot
  );

  const warnings = [];

  try {
    await runGit(
      ["worktree", "remove", worktreeRoot],
      repositoryRoot
    );
  } catch (error) {
    warnings.push(
      `No se pudo eliminar completamente el worktree: ${error.message}`
    );

    try {
      await runGit(
        ["worktree", "prune"],
        repositoryRoot
      );
    } catch (pruneError) {
      warnings.push(
        `No se pudo depurar el registro: ${pruneError.message}`
      );
    }
  }

  try {
    await runGit(
      ["branch", "-d", branchName],
      repositoryRoot
    );
  } catch (error) {
    warnings.push(
      `No se pudo eliminar la rama local: ${error.message}`
    );
  }

  return {
    commitHash: commitResult.stdout,
    repositoryRoot,
    warnings,
  };
}
