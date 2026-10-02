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
  assignedRole = null,
  frontendPath = null,
  backendPath = null,
  branchName,
  baseBranch = "main",
}) {
  if (assignedRole === "fullstack") {
    return prepareFullstackTaskWorktree({
      taskId,
      frontendPath,
      backendPath,
      branchName,
      baseBranch,
    });
  }

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
    worktreePath: worktreeRoot,
    worktreeRoot,
    agentWorkingPath: agentWorkingDirectory,
    agentWorkingDirectory,
    branchName,
    baseBranch,
  };
}

async function resolveRepositoryRoot(
  directory
) {
  const safeDirectory =
    validateAllowedPath(directory);

  try {
    await fs.access(safeDirectory);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `La ruta no existe: ${safeDirectory}`
      );
    }

    throw error;
  }

  const repositoryResult = await runGit(
    ["rev-parse", "--show-toplevel"],
    safeDirectory
  );

  return {
    directory: safeDirectory,
    repositoryRoot: validateAllowedPath(
      repositoryResult.stdout
    ),
  };
}

function resolveRelativePath({
  repositoryRoot,
  directory,
}) {
  const relativePath = path.relative(
    repositoryRoot,
    directory
  );

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "El directorio asignado no pertenece al repositorio"
    );
  }

  return relativePath;
}

function assertRelativePathDoesNotEscape(
  relativePath
) {
  const normalized = path.normalize(
    relativePath
  );

  if (
    path.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(
      `La ruta relativa escapa del repositorio: ${relativePath}`
    );
  }

  return normalized;
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

function isPathInside(parent, child) {
  const relativePath = path.relative(
    parent,
    child
  );

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") &&
      !path.isAbsolute(relativePath))
  );
}

async function resolveProjectPath({
  projectPath,
  repositoryRoot,
  label,
}) {
  if (!projectPath?.trim()) {
    throw new Error(
      `La ruta ${label} no está configurada`
    );
  }

  const trimmedPath = projectPath.trim();
  const isAbsolute = path.isAbsolute(trimmedPath);
  const directory = isAbsolute
    ? validateAllowedPath(trimmedPath)
    : path.join(
        repositoryRoot,
        assertRelativePathDoesNotEscape(
          trimmedPath
        )
      );

  const safeDirectory =
    validateAllowedPath(directory);

  if (
    repositoryRoot &&
    !isPathInside(
      repositoryRoot,
      safeDirectory
    )
  ) {
    throw new Error(
      `La ruta ${label} no pertenece a la raíz Git principal`
    );
  }

  if (!(await pathExists(safeDirectory))) {
    throw new Error(
      `La ruta ${label} no existe: ${safeDirectory}`
    );
  }

  const projectRepositoryRoot = (
    await resolveRepositoryRoot(safeDirectory)
  ).repositoryRoot;

  if (
    repositoryRoot &&
    projectRepositoryRoot !== repositoryRoot
  ) {
    throw new Error(
      `La ruta ${label} pertenece a otro repositorio Git`
    );
  }

  return {
    directory: safeDirectory,
    repositoryRoot: projectRepositoryRoot,
    relativePath: resolveRelativePath({
      repositoryRoot: projectRepositoryRoot,
      directory: safeDirectory,
    }),
  };
}

export async function resolveFullstackProjectPaths({
  frontendPath,
  backendPath,
  repositoryRoot = null,
  worktreeRoot = null,
}) {
  if (!frontendPath?.trim()) {
    throw new Error(
      "frontend_path no está configurado"
    );
  }

  if (!backendPath?.trim()) {
    throw new Error(
      "backend_path no está configurado"
    );
  }

  const normalizedFrontendPath =
    frontendPath.trim();
  const normalizedBackendPath =
    backendPath.trim();

  if (
    !path.isAbsolute(normalizedFrontendPath) ||
    !path.isAbsolute(normalizedBackendPath)
  ) {
    throw new Error(
      "Las tareas fullstack requieren frontend_path y backend_path absolutos"
    );
  }

  let mainRepositoryRoot = repositoryRoot
    ? validateAllowedPath(repositoryRoot)
    : null;

  if (!mainRepositoryRoot) {
    const frontendRepository = (
      await resolveRepositoryRoot(
        validateAllowedPath(
          normalizedFrontendPath
        )
      )
    ).repositoryRoot;

    const backendRepository = (
      await resolveRepositoryRoot(
        validateAllowedPath(
          normalizedBackendPath
        )
      )
    ).repositoryRoot;

    if (
      path.resolve(
        frontendRepository
      ).toLowerCase() !==
      path.resolve(
        backendRepository
      ).toLowerCase()
    ) {
      throw new Error(
        "La tarea fullstack requiere que frontend_path y backend_path pertenezcan al mismo repositorio Git"
      );
    }

    mainRepositoryRoot = frontendRepository;
  }
  const frontend = await resolveProjectPath({
	projectPath: normalizedFrontendPath,
    repositoryRoot: mainRepositoryRoot,
    label: "frontend_path",
  });
  const backend = await resolveProjectPath({
    projectPath: normalizedBackendPath,
    repositoryRoot: mainRepositoryRoot,
    label: "backend_path",
  });

  const result = {
    repositoryRoot: mainRepositoryRoot,
    frontendOriginalDirectory:
      frontend.directory,
    backendOriginalDirectory: backend.directory,
    frontendRelativePath:
      frontend.relativePath,
    backendRelativePath: backend.relativePath,
  };

  if (worktreeRoot) {
    const safeWorktree =
      validateAllowedPath(worktreeRoot);
    const frontendWorkingDirectory =
      validateAllowedPath(
        path.join(
          safeWorktree,
          frontend.relativePath
        )
      );
    const backendWorkingDirectory =
      validateAllowedPath(
        path.join(
          safeWorktree,
          backend.relativePath
        )
      );

    if (
      !isPathInside(
        safeWorktree,
        frontendWorkingDirectory
      ) ||
      !isPathInside(
        safeWorktree,
        backendWorkingDirectory
      )
    ) {
      throw new Error(
        "Las rutas fullstack resueltas no pertenecen al worktree esperado"
      );
    }

    if (
      !(await pathExists(
        frontendWorkingDirectory
      )) ||
      !(await pathExists(
        backendWorkingDirectory
      ))
    ) {
      throw new Error(
        "Las rutas fullstack resueltas no existen dentro del worktree"
      );
    }

    return {
      ...result,
      frontendWorkingDirectory,
      backendWorkingDirectory,
    };
  }

  return result;
}

async function prepareFullstackTaskWorktree({
  taskId,
  frontendPath,
  backendPath,
  branchName,
  baseBranch = "main",
}) {
  validateBranchName(branchName);
  validateBranchName(baseBranch);

  const projectPaths =
    await resolveFullstackProjectPaths({
      frontendPath,
      backendPath,
    });

  const statusResult = await runGit(
    ["status", "--porcelain"],
    projectPaths.repositoryRoot
  );

  if (statusResult.stdout) {
    throw new Error(
      "El repositorio principal tiene cambios sin guardar. HacÃ© commit o descartalos antes de ejecutar un agente."
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
    projectPaths.repositoryRoot
  );

  const worktreePaths =
    await resolveFullstackProjectPaths({
      frontendPath,
      backendPath,
      repositoryRoot:
        projectPaths.repositoryRoot,
      worktreeRoot,
    });

  return {
    repositoryRoot:
      projectPaths.repositoryRoot,
    worktreePath: worktreeRoot,
    worktreeRoot,
    agentWorkingPath: worktreeRoot,
    agentWorkingDirectory: worktreeRoot,
    frontendWorkingPath:
      worktreePaths.frontendWorkingDirectory,
    backendWorkingPath:
      worktreePaths.backendWorkingDirectory,
    frontendWorkingDirectory:
      worktreePaths.frontendWorkingDirectory,
    backendWorkingDirectory:
      worktreePaths.backendWorkingDirectory,
    frontendRelativePath:
      worktreePaths.frontendRelativePath,
    backendRelativePath:
      worktreePaths.backendRelativePath,
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


export async function pushApprovedCommit({
  targetDirectory,
  baseBranch = "main",
  commitHash,
  remote = "origin",
}) {
  const safeTargetDirectory = validateAllowedPath(targetDirectory);
  validateBranchName(baseBranch);

  if (!/^[a-zA-Z0-9._-]+$/.test(remote)) {
    throw new Error(`Nombre de remote inválido: ${remote}`);
  }
  if (!/^[0-9a-fA-F]{7,40}$/.test(String(commitHash || ""))) {
    throw new Error("Commit aprobado inválido");
  }

  const repositoryResult = await runGit(
    ["rev-parse", "--show-toplevel"],
    safeTargetDirectory
  );
  const repositoryRoot = validateAllowedPath(repositoryResult.stdout);

  const statusResult = await runGit(["status", "--porcelain"], repositoryRoot);
  if (statusResult.stdout) {
    throw new Error(
      "El repositorio principal tiene cambios sin guardar. No se puede hacer PUSH."
    );
  }

  const branchResult = await runGit(["branch", "--show-current"], repositoryRoot);
  if (branchResult.stdout !== baseBranch) {
    throw new Error(
      `El repositorio principal debe estar en ${baseBranch}, pero está en ${branchResult.stdout}`
    );
  }

  const headResult = await runGit(["rev-parse", "HEAD"], repositoryRoot);
  if (headResult.stdout.toLowerCase() !== String(commitHash).toLowerCase()) {
    throw new Error(
      `HEAD (${headResult.stdout}) no coincide con el commit aprobado (${commitHash}).`
    );
  }

  await runGit(["remote", "get-url", remote], repositoryRoot);

  const startedAt = Date.now();
  const pushResult = await runGit(["push", remote, baseBranch], repositoryRoot);

  return {
    repositoryRoot,
    remote,
    branch: baseBranch,
    commitHash: headResult.stdout,
    durationMs: Date.now() - startedAt,
    stdout: pushResult.stdout,
    stderr: pushResult.stderr,
  };
}
