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