import { Router } from "express";
import { pool } from "../db.js";
import {
  validateProjectPath,
  InvalidPathError,
} from "../services/project-validation.service.js";
import {
  createProjectFromScratch,
  rollbackScaffoldedProject,
  ExistingProjectPathError,
} from "../services/project-scaffold.service.js";
import {
  runProjectCreateAndStart,
  STAGE_NAMES,
  ExistingDatabaseError,
} from "../services/project-launch.service.js";
import {
  createJob,
  onStageFactory,
  attachProjectToJob,
  updateJobStatus,
  completeJob,
  failJob,
  getJob,
  getLatestProjectJob,
  getLatestLaunchJob,
  getActiveJobForRequest,
} from "../services/launch-jobs.service.js";
import {
  startBackendProcess,
  startFrontendProcess,
  stopProjectProcesses,
  getProjectProcessesStatus,
} from "../services/project-process-manager.service.js";

const router = Router();

function cleanText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

async function validateProjectInput(body) {
  const name = cleanText(body.name);
  const description = cleanText(
    body.description
  );
  const frontendPath = cleanText(
    body.frontendPath
  );
  const backendPath = cleanText(
    body.backendPath
  );
  const repositoryUrl = cleanText(
    body.repositoryUrl
  );
  const defaultBranch =
    cleanText(body.defaultBranch) || "main";

  if (!name) {
    throw new Error(
      "El nombre del proyecto es obligatorio"
    );
  }

  if (!frontendPath && !backendPath) {
    throw new Error(
      "Debés indicar al menos una ruta frontend o backend"
    );
  }

  const [frontend, backend] =
    await Promise.all([
      frontendPath
        ? validateProjectPath(
            frontendPath,
            "frontend"
          )
        : null,

      backendPath
        ? validateProjectPath(
            backendPath,
            "backend"
          )
        : null,
    ]);

  return {
    name,
    description,
    frontendPath:
      frontend?.path || null,
    backendPath:
      backend?.path || null,
    repositoryUrl:
      repositoryUrl || null,
    defaultBranch,
    repositories: {
      frontend:
        frontend?.repositoryRoot || null,
      backend:
        backend?.repositoryRoot || null,
    },
  };
}

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM projects
      ORDER BY active DESC, name ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(
      "Error listando proyectos:",
      error
    );

    res.status(500).json({
      status: "error",
      message:
        "No se pudieron obtener los proyectos",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const project =
      await validateProjectInput(
        req.body
      );

    const result = await pool.query(
      `
        INSERT INTO projects (
          name,
          description,
          frontend_path,
          backend_path,
          repository_url,
          default_branch,
          active
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          TRUE
        )
        RETURNING *
      `,
      [
        project.name,
        project.description,
        project.frontendPath,
        project.backendPath,
        project.repositoryUrl,
        project.defaultBranch,
      ]
    );

    res.status(201).json({
      project: result.rows[0],
      repositories:
        project.repositories,
    });
  } catch (error) {
    console.error(
      "Error creando proyecto:",
      error
    );

    if (error.code === "23505") {
      return res.status(409).json({
        status: "error",
        message:
          "Ya existe un proyecto con ese nombre",
      });
    }

    res.status(400).json({
      status: "error",
      message: error.message,
    });
  }
});

router.post("/scaffold", async (req, res) => {
  const name = cleanText(req.body.name);
  const description = cleanText(req.body.description);
  const projectPath = cleanText(req.body.projectPath);
  const repositoryUrl = cleanText(req.body.repositoryUrl);
  const defaultBranch = cleanText(req.body.defaultBranch) || "main";
  const autoStart = req.body.autoStart === true;

  if (!name) {
    return res.status(400).json({
      status: "error",
      message: "El nombre del proyecto es obligatorio",
    });
  }

  if (!projectPath) {
    return res.status(400).json({
      status: "error",
      message:
        "Debés indicar la carpeta destino del proyecto para crear uno nuevo",
    });
  }

  if (autoStart) {
    const activeJob = await getActiveJobForRequest({
      requestedName: name,
      requestedProjectPath: projectPath,
    });

    if (activeJob) {
      return res.status(409).json({
        status: "error",
        mode: "job",
        message:
          "Ya existe una creacion e inicio en curso para ese proyecto",
        job: activeJob,
        jobId: activeJob.jobId,
      });
    }

    const jobId = await createJob(STAGE_NAMES, {
      requestedName: name,
      requestedProjectPath: projectPath,
    });
    const onStage = onStageFactory(jobId);

    setImmediate(() => {
      updateJobStatus(jobId, "running")
        .then(() =>
          runProjectCreateAndStart({
            name,
            description,
            projectPath,
            repositoryUrl: repositoryUrl || null,
            defaultBranch,
            onStage,
            onProjectCreated: (projectId) =>
              attachProjectToJob(jobId, projectId),
          })
        )
        .then((result) => {
          return completeJob(jobId, {
            project: result.project,
            frontendUrl: result.frontendUrl,
            backendUrl: result.backendUrl,
            frontendPort: result.frontendPort,
            backendPort: result.backendPort,
            databaseName: result.dbName,
            dependenciesInstalled: result.dependenciesInstalled,
            migrationsApplied: result.migrationsApplied,
          });
        })
        .catch((error) => {
          console.error("Error en creacion e inicio automatico:", error);
          return failJob(jobId, error);
        });
    });

    return res.status(202).json({ mode: "job", jobId });
  }

  try {
    const created =
      await createProjectFromScratch({
        name,
        projectPath,
      });

    let result;

    try {
      result = await pool.query(
        `
          INSERT INTO projects (
            name,
            description,
            frontend_path,
            backend_path,
            repository_url,
            default_branch,
            active
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            TRUE
          )
          RETURNING *
        `,
        [
          name,
          description,
          created.frontendPath,
          created.backendPath,
          repositoryUrl || null,
          defaultBranch,
        ]
      );
    } catch (dbError) {
      await rollbackScaffoldedProject(created).catch((rollbackError) => {
        console.error(
          "Error revirtiendo archivos del proyecto tras fallo de registro:",
          rollbackError
        );

        dbError.cleanupWarning = rollbackError.cleanupWarning || rollbackError.message;
      });

      throw dbError;
    }

    res.status(201).json({
      mode: "created",
      project: result.rows[0],
    });
  } catch (error) {
    if (
      error instanceof
      ExistingProjectPathError
    ) {
      return res.status(409).json({
        status: "error",
        mode: "maintenance",
        message: error.message,
        details: error.details,
        ...(error.cleanupWarning && {
          cleanup_warning: error.cleanupWarning,
        }),
      });
    }

    if (error instanceof InvalidPathError) {
      return res.status(400).json({
        status: "error",
        message: error.message,
      });
    }

    console.error(
      "Error creando proyecto desde cero:",
      error
    );

    if (error.code === "23505") {
      return res.status(409).json({
        status: "error",
        message:
          "Ya existe un proyecto con ese nombre",
        ...(error.cleanupWarning && {
          cleanup_warning: error.cleanupWarning,
        }),
      });
    }

    if (error instanceof ExistingDatabaseError) {
      return res.status(409).json({
        status: "error",
        mode: "conflict",
        message: error.message,
        details: error.details,
        ...(error.cleanupWarning && {
          cleanup_warning: error.cleanupWarning,
        }),
      });
    }

    res.status(500).json({
      status: "error",
      message: error.message,
      ...(error.cleanupWarning && {
        cleanup_warning: error.cleanupWarning,
      }),
    });
  }
});

router.get("/jobs/latest", async (req, res) => {
  const job = await getLatestLaunchJob();

  if (!job) {
    return res.status(404).json({
      status: "error",
      message: "No se encontrÃ³ un proceso de creaciÃ³n previo",
    });
  }

  res.json(job);
});

router.get("/jobs/:jobId", async (req, res) => {
  const job = await getJob(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      status: "error",
      message: "No se encontró el proceso de creación indicado",
    });
  }

  res.json(job);
});

router.get("/:id/launch-job", async (req, res) => {
  const job = await getLatestProjectJob(req.params.id);

  if (!job) {
    return res.status(404).json({
      status: "error",
      message: "No se encontrÃ³ un proceso de creaciÃ³n para el proyecto",
    });
  }

  res.json(job);
});

async function getProjectOr404(req, res) {
  const result = await pool.query(
    "SELECT * FROM projects WHERE id = $1",
    [req.params.id]
  );

  if (result.rowCount === 0) {
    res.status(404).json({
      status: "error",
      message: "Proyecto no encontrado",
    });
    return null;
  }

  return result.rows[0];
}

router.get("/:id/processes", async (req, res) => {
  try {
    const project = await getProjectOr404(req, res);

    if (!project) {
      return;
    }

    const status = await getProjectProcessesStatus(project.id);

    res.json(status);
  } catch (error) {
    console.error("Error consultando procesos del proyecto:", error);

    res.status(500).json({
      status: "error",
      message: "No se pudo consultar el estado de los procesos",
    });
  }
});

router.post("/:id/start", async (req, res) => {
  try {
    const project = await getProjectOr404(req, res);

    if (!project) {
      return;
    }

    if (!project.backend_path || !project.frontend_path) {
      return res.status(400).json({
        status: "error",
        message:
          "El proyecto necesita frontend_path y backend_path configurados para iniciarse",
      });
    }

    const backendResult = await startBackendProcess({ project });

    const frontendResult = await startFrontendProcess({
      project,
      backendPort: backendResult.port || backendResult.row?.port,
    });

    res.json({
      backend: backendResult,
      frontend: frontendResult,
    });
  } catch (error) {
    console.error("Error iniciando procesos del proyecto:", error);

    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

router.post("/:id/stop", async (req, res) => {
  try {
    const project = await getProjectOr404(req, res);

    if (!project) {
      return;
    }

    await stopProjectProcesses(project.id);

    res.json({ status: "ok" });
  } catch (error) {
    console.error("Error deteniendo procesos del proyecto:", error);

    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

router.post("/:id/restart", async (req, res) => {
  try {
    const project = await getProjectOr404(req, res);

    if (!project) {
      return;
    }

    await stopProjectProcesses(project.id);

    const backendResult = await startBackendProcess({ project });

    const frontendResult = await startFrontendProcess({
      project,
      backendPort: backendResult.port || backendResult.row?.port,
    });

    res.json({
      backend: backendResult,
      frontend: frontendResult,
    });
  } catch (error) {
    console.error("Error reiniciando procesos del proyecto:", error);

    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const project =
      await validateProjectInput(
        req.body
      );

    const result = await pool.query(
      `
        UPDATE projects
        SET name = $2,
            description = $3,
            frontend_path = $4,
            backend_path = $5,
            repository_url = $6,
            default_branch = $7,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [
        req.params.id,
        project.name,
        project.description,
        project.frontendPath,
        project.backendPath,
        project.repositoryUrl,
        project.defaultBranch,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        status: "error",
        message:
          "Proyecto no encontrado",
      });
    }

    res.json({
      project: result.rows[0],
      repositories:
        project.repositories,
    });
  } catch (error) {
    console.error(
      "Error actualizando proyecto:",
      error
    );

    if (error.code === "23505") {
      return res.status(409).json({
        status: "error",
        message:
          "Ya existe un proyecto con ese nombre",
      });
    }

    res.status(400).json({
      status: "error",
      message: error.message,
    });
  }
});

router.patch(
  "/:id/status",
  async (req, res) => {
    if (
      typeof req.body.active !==
      "boolean"
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "active debe ser true o false",
      });
    }

    try {
      const result = await pool.query(
        `
          UPDATE projects
          SET active = $2,
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          req.params.id,
          req.body.active,
        ]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          status: "error",
          message:
            "Proyecto no encontrado",
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "Error cambiando estado:",
        error
      );

      res.status(500).json({
        status: "error",
        message:
          "No se pudo cambiar el estado",
      });
    }
  }
);

export default router;
