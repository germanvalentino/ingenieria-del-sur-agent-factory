import { Router } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { pool } from "../db.js";
import { executeCodex } from "../services/codex.service.js";
import { runQaValidation } from "../services/qa.service.js";

import {
  finalizeTaskWorktree,
  getWorktreeStatus,
  prepareTaskWorktree,
} from "../services/git-worktree.service.js";
import {
  finishTaskExecution,
  getTaskExecutionsSummary,
  startTaskExecution,
} from "../services/task-executions.service.js";
const router = Router();

const VALID_ROLES = [
  "frontend",
  "backend",
  "fullstack",
  "qa",
];

const MAX_AUTOMATIC_CORRECTIONS = 3;

function buildAllowedPathsPrompt({
  assignedRole,
  frontendWorkingDirectory,
  backendWorkingDirectory,
  agentWorkingDirectory,
}) {
  if (assignedRole === "fullstack") {
    return [
      "RUTAS PERMITIDAS:",
      `- FRONTEND: ${frontendWorkingDirectory}`,
      `- BACKEND: ${backendWorkingDirectory}`,
      "- PodÃ©s modificar ambas rutas permitidas.",
    ].join("\n");
  }

  return [
    "RUTA PERMITIDA:",
    `- ${agentWorkingDirectory}`,
  ].join("\n");
}

function createBranchName(role, title) {
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  return `feature/${role}-${Date.now()}-${slug}`;
}

function getQaProjectDirectories(task) {
  if (task.assigned_role !== "fullstack") {
    return null;
  }

  return [
    {
      label: "FRONTEND",
      directory: task.frontend_working_path,
    },
    {
      label: "BACKEND",
      directory: task.backend_working_path,
    },
  ];
}

function normalizeQaFindings(summary) {
  const qaReview = String(summary || "")
    .split("=== REVISIÃ“N DE CÃ“DIGO CODEX ===")
    .pop();
  const findingsMatch = qaReview.match(
    /HALLAZGOS:\s*([\s\S]*?)(?:\n\s*RIESGOS:|$)/i
  );
  const comparableText =
    findingsMatch?.[1] || qaReview;

  return comparableText
    .replace(/\s+/g, " ")
    .trim();
}

function buildCorrectionPrompt({
  agent,
  task,
  qaSummary,
  attemptNumber,
}) {
  const allowedPathsPrompt =
    buildAllowedPathsPrompt({
      assignedRole: task.assigned_role,
      frontendWorkingDirectory:
        task.frontend_working_path,
      backendWorkingDirectory:
        task.backend_working_path,
      agentWorkingDirectory:
        task.agent_working_path,
    });

  return `
Sos el ${agent.name} de IngenierÃ­a del Sur.

EstÃ¡s corrigiendo una implementaciÃ³n existente dentro del mismo git worktree y la misma rama.

INTENTO DE CORRECCIÃ“N AUTOMÃTICA:
${attemptNumber} de ${MAX_AUTOMATIC_CORRECTIONS}

TAREA ORIGINAL:
${task.title}

DESCRIPCIÃ“N ORIGINAL:
${
  task.description ||
  "Sin descripciÃ³n adicional."
}

RESULTADO COMPLETO DEL ÃšLTIMO QA:
${qaSummary || "No hay resultado QA disponible."}

INSTRUCCIONES:
- RevisÃ¡ los cambios existentes antes de modificar.
- CorregÃ­ solamente los hallazgos del QA.
- ConservÃ¡ las partes que ya funcionan correctamente.
- TrabajÃ¡ solamente dentro del directorio asignado.
- MantenÃ© el mismo worktree y la misma rama.
- No cambies de rama.
${allowedPathsPrompt}

- No hagas commit, push, merge ni deploy.
- No leas ni muestres archivos .env.
- EjecutÃ¡ lint, tests o build cuando correspondan.
- InformÃ¡ archivos modificados, validaciones realizadas y riesgos pendientes.
`;
}

async function runQaAttempt({
  task,
  qaAgent,
  attemptNumber,
}) {
  let executionId;

  await pool.query(
    `
      UPDATE tasks
      SET qa_status = 'running',
          auto_correction_stage = 'qa',
          qa_started_at = NOW(),
          qa_finished_at = NULL,
          qa_summary = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
    [task.id]
  );

  const execution = await startTaskExecution({
    taskId: task.id,
    agentId: qaAgent.id,
    executionType: "qa",
    provider: qaAgent.provider,
  });

  executionId = execution.id;

  try {
    const qaResult = await runQaValidation({
      workingDirectory: task.agent_working_path,
      projectDirectories:
        getQaProjectDirectories(task),
      baseBranch: task.base_branch || "main",
      taskTitle: task.title,
      taskDescription: task.description,
      correctionFeedback:
        task.correction_feedback,
    });

    const finalSummary = [
      `QA automÃ¡tico intento ${attemptNumber}`,
      "",
      qaResult.summary,
    ].join("\n");

    const updatedTaskResult =
      await pool.query(
        `
          UPDATE tasks
          SET status = 'review',
              qa_status = $2,
              qa_summary = $3,
              qa_finished_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          task.id,
          qaResult.status,
          finalSummary.slice(-15000),
        ]
      );

    await finishTaskExecution({
      executionId,
      status: qaResult.status,
      usage: qaResult.codexUsage,
      model: qaResult.codexModel,
    });

    return {
      task: updatedTaskResult.rows[0],
      qaResult: {
        ...qaResult,
        summary: finalSummary,
      },
    };
  } catch (error) {
    await finishTaskExecution({
      executionId,
      status: "failed",
      errorMessage: error.message,
    });

    throw error;
  }
}

async function runCorrectionAttempt({
  task,
  agent,
  qaSummary,
  attemptNumber,
  statusBeforeCorrection,
}) {
  let executionId;

  await pool.query(
    `
      UPDATE tasks
      SET status = 'running',
          qa_status = 'pending',
          auto_correction_stage = 'correction',
          execution_started_at = NOW(),
          execution_finished_at = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
    [task.id]
  );

  const execution = await startTaskExecution({
    taskId: task.id,
    agentId: agent.id,
    executionType: "correction",
    provider: agent.provider,
  });

  executionId = execution.id;

  try {
    const correctionResult = await executeCodex({
      workingDirectory: task.agent_working_path,
      prompt: buildCorrectionPrompt({
        agent,
        task,
        qaSummary,
        attemptNumber,
      }),
      sandbox: "workspace-write",
    });

    const gitStatus = await getWorktreeStatus(
      task.worktree_path
    );
    const leftChanges =
      Boolean(gitStatus) &&
      gitStatus !== statusBeforeCorrection;

    const correctionSummary = [
      "",
      "",
      `=== CORRECCIÃ“N AUTOMÃTICA ${attemptNumber} DE ${MAX_AUTOMATIC_CORRECTIONS} ===`,
      correctionResult.output,
      "",
      "ESTADO DEL WORKTREE:",
      gitStatus || "Sin cambios pendientes.",
    ].join("\n");

    const updatedTaskResult =
      await pool.query(
        `
          UPDATE tasks
          SET status = 'review',
              qa_status = 'pending',
              correction_feedback = $2,
              correction_count = correction_count + 1,
              correction_attempts = correction_attempts + 1,
              auto_correction_finished_count =
                auto_correction_finished_count + 1,
              execution_finished_at = NOW(),
              result_summary =
                COALESCE(result_summary, '')
                || $3,
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          task.id,
          qaSummary.slice(-15000),
          correctionSummary.slice(-15000),
        ]
      );

    await finishTaskExecution({
      executionId,
      status: leftChanges ? "passed" : "failed",
      usage: correctionResult.usage,
      model: correctionResult.model,
      errorMessage: leftChanges
        ? null
        : "La correcciÃ³n automÃ¡tica no dejÃ³ cambios nuevos.",
    });

    return {
      task: updatedTaskResult.rows[0],
      gitStatus,
      leftChanges,
    };
  } catch (error) {
    await finishTaskExecution({
      executionId,
      status: "failed",
      errorMessage: error.message,
    });

    throw error;
  }
}

router.post("/", async (req, res) => {
  const {
    projectId,
    title,
    description = "",
    assignedRole,
  } = req.body;

  if (
    !projectId ||
    !title?.trim() ||
    !assignedRole
  ) {
    return res.status(400).json({
      status: "error",
      message:
        "projectId, title y assignedRole son obligatorios",
    });
  }

  if (!VALID_ROLES.includes(assignedRole)) {
    return res.status(400).json({
      status: "error",
      message: "El rol asignado no es válido",
    });
  }

  try {
	     if (assignedRole === "fullstack") {
      const projectResult = await pool.query(
        `
          SELECT
            frontend_path,
            backend_path
          FROM projects
          WHERE id = $1
            AND active = TRUE
        `,
        [projectId]
      );

      const project = projectResult.rows[0];
      const frontendPath =
        project?.frontend_path?.trim();
      const backendPath =
        project?.backend_path?.trim();

      if (!frontendPath || !backendPath) {
        return res.status(400).json({
          status: "error",
          message:
            "El proyecto fullstack debe tener frontend_path y backend_path configurados",
        });
      }

      if (
        !path.isAbsolute(frontendPath) ||
        !path.isAbsolute(backendPath)
      ) {
        return res.status(400).json({
          status: "error",
          message:
            "Las tareas fullstack requieren frontend_path y backend_path absolutos",
        });
      }
    }
    const result = await pool.query(
      `
        INSERT INTO tasks (
          project_id,
          title,
          description,
          assigned_role,
          status,
          branch_name,
          base_branch
        )
        SELECT
          p.id,
          $2,
          $3,
          $4::varchar,
          'queued',
          $5,
          COALESCE(
            NULLIF(TRIM(p.default_branch), ''),
            'main'
          )
        FROM projects p
        WHERE p.id = $1
          AND p.active = TRUE
          AND CASE
            WHEN $4::varchar = 'frontend'
              THEN p.frontend_path IS NOT NULL
                AND TRIM(p.frontend_path) <> ''
            WHEN $4::varchar = 'fullstack'
              THEN p.frontend_path IS NOT NULL
                AND TRIM(p.frontend_path) <> ''
                AND p.backend_path IS NOT NULL
                AND TRIM(p.backend_path) <> ''
            WHEN $4 IN ('backend', 'qa')
              THEN p.backend_path IS NOT NULL
                AND TRIM(p.backend_path) <> ''
            ELSE FALSE
          END
        RETURNING tasks.*
      `,
      [
        projectId,
        title.trim(),
        description.trim(),
        assignedRole,
        createBranchName(
          assignedRole,
          title.trim()
        ),
      ]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({
        status: "error",
        message:
          "El proyecto no existe, está inactivo o no tiene configurada la ruta requerida para el agente",
      });
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(
      "Error creando tarea:",
      error
    );

    res.status(500).json({
      status: "error",
      message: "No se pudo crear la tarea",
    });
  }
});


router.post(
  "/:id/retry",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          UPDATE tasks
          SET status = 'queued',
              qa_status = 'pending',
              qa_summary = NULL,
              execution_started_at = NULL,
              execution_finished_at = NULL,
              result_summary =
                COALESCE(
                  result_summary,
                  ''
                )
                || E'\\n\\nREINTENTO SOLICITADO:\\n'
                || 'La tarea fue devuelta a la cola.',
              updated_at = NOW()
          WHERE id = $1
            AND status = 'failed'
          RETURNING *
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return res.status(409).json({
          status: "error",
          message:
            "La tarea no existe o no está fallida",
        });
      }

      await pool.query(`
        UPDATE agents
        SET status = 'idle',
            updated_at = NOW()
        WHERE status = 'working'
      `);

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "Error reintentando tarea:",
        error
      );

      res.status(500).json({
        status: "error",
        message:
          "No se pudo reintentar la tarea",
      });
    }
  }
);

router.get(
  "/:id/executions",
  async (req, res) => {
    try {
      const taskResult = await pool.query(
        `
          SELECT id
          FROM tasks
          WHERE id = $1
        `,
        [req.params.id]
      );

      if (taskResult.rowCount === 0) {
        return res.status(404).json({
          status: "error",
          message: "Tarea no encontrada",
        });
      }

      const result =
        await getTaskExecutionsSummary(
          req.params.id
        );

      res.json(result);
    } catch (error) {
      console.error(
        "Error obteniendo ejecuciones:",
        error
      );

      res.status(500).json({
        status: "error",
        message:
          "No se pudieron obtener las ejecuciones",
      });
    }
  }
);


router.post("/:id/run", async (req, res) => {
  let agentId;
  let worktree;
  let executionId;

  try {
    const taskResult = await pool.query(
      `
        SELECT
          t.*,
          p.name AS project_name,
          p.frontend_path,
          p.backend_path
        FROM tasks t
        INNER JOIN projects p
          ON p.id = t.project_id
        WHERE t.id = $1
      `,
      [req.params.id]
    );

    const task = taskResult.rows[0];

    if (!task) {
      return res.status(404).json({
        status: "error",
        message: "Tarea no encontrada",
      });
    }

    if (task.status !== "queued") {
      return res.status(409).json({
        status: "error",
        message:
          `La tarea está en estado ${task.status}`,
      });
    }

    const targetDirectory =
      task.assigned_role === "frontend"
        ? task.frontend_path
        : task.backend_path;

    if (
      task.assigned_role === "fullstack" &&
      (!task.frontend_path ||
        !task.backend_path)
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "El proyecto no tiene configuradas frontend_path y backend_path para el agente fullstack",
      });
    }

    if (
      task.assigned_role !== "fullstack" &&
      !targetDirectory
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "El proyecto no tiene una ruta configurada para el agente",
      });
    }

    const agentResult = await pool.query(
      `
        SELECT *
        FROM agents
        WHERE role = $1
          AND active = TRUE
        LIMIT 1
      `,
      [task.assigned_role]
    );

    const agent = agentResult.rows[0];

    if (!agent) {
      return res.status(400).json({
        status: "error",
        message:
          "No existe un agente activo para esta tarea",
      });
    }

    agentId = agent.id;

    /*
     * El worktree se prepara antes de ejecutar
     * Codex. La carpeta principal no se modifica.
     */
const existingWorktreeIsValid =
  task.worktree_path &&
  task.agent_working_path &&
  existsSync(task.worktree_path) &&
  existsSync(task.agent_working_path);

if (existingWorktreeIsValid) {
  if (
    task.assigned_role === "fullstack" &&
    (!task.frontend_working_path ||
      !task.backend_working_path)
  ) {
    throw new Error(
      "La tarea fullstack tiene un worktree existente sin frontend_working_path o backend_working_path. VolvÃ© a ejecutar el agente para regenerar el worktree."
    );
  }

  worktree = {
    worktreePath:
      task.worktree_path,
    worktreeRoot:
      task.worktree_path,
    agentWorkingPath:
      task.agent_working_path,
    agentWorkingDirectory:
      task.agent_working_path,
    frontendWorkingPath:
      task.frontend_working_path,
    backendWorkingPath:
      task.backend_working_path,
    frontendWorkingDirectory:
      task.frontend_working_path,
    backendWorkingDirectory:
      task.backend_working_path,
    branchName:
      task.branch_name,
    baseBranch:
      task.base_branch || "main",
  };

  console.log(
    `Reutilizando worktree para tarea ${task.id}: ${task.worktree_path}`
  );
} else {
  worktree = await prepareTaskWorktree({
    taskId: task.id,
    targetDirectory,
    assignedRole:
      task.assigned_role,
    frontendPath:
      task.frontend_path,
    backendPath:
      task.backend_path,
    branchName:
      task.branch_name,
    baseBranch:
      task.base_branch || "main",
  });
}

    const allowedPathsPrompt =
      buildAllowedPathsPrompt({
        assignedRole:
          task.assigned_role,
        frontendWorkingDirectory:
          worktree.frontendWorkingPath,
        backendWorkingDirectory:
          worktree.backendWorkingPath,
        agentWorkingDirectory:
          worktree.agentWorkingPath,
      });

    await pool.query(
      `
       UPDATE tasks
SET status = 'running',
    worktree_path = $2,
    agent_working_path = $3,
    frontend_working_path = $4,
    backend_working_path = $5,
    qa_status = 'pending',
    execution_started_at = NOW(),
    execution_finished_at = NULL,
    updated_at = NOW()
WHERE id = $1
      `,
      [
  task.id,
  worktree.worktreePath,
  worktree.agentWorkingPath,
  worktree.frontendWorkingPath || null,
  worktree.backendWorkingPath || null,
]
    );

    await pool.query(
      `
        UPDATE agents
        SET status = 'working',
            updated_at = NOW()
        WHERE id = $1
      `,
      [agent.id]
    );

    const execution =
      await startTaskExecution({
        taskId: task.id,
        agentId: agent.id,
        executionType: "development",
        provider: agent.provider,
      });

    executionId = execution.id;

    const prompt = `
Sos el ${agent.name} de Ingeniería del Sur.

PROYECTO:
${task.project_name}

ROL:
${task.assigned_role}

TAREA:
${task.title}

DESCRIPCIÓN Y CRITERIOS:
${
  task.description ||
  "No se proporcionó descripción adicional."
}

CONTEXTO GIT:
- Rama asignada: ${task.branch_name}
- Rama base: ${task.base_branch || "main"}
- Estás trabajando dentro de un git worktree aislado.
- La carpeta principal del usuario no debe modificarse.

${allowedPathsPrompt}

REGLAS OBLIGATORIAS:
- Trabajá solamente dentro del directorio asignado.
- No cambies de rama.
- No crees otro worktree.
- No hagas git commit.
- No hagas git push.
- No hagas merge.
- No despliegues.
- No modifiques bases de datos de producción.
- No leas ni muestres archivos .env.
- Conservá el stack y la estructura existente.
- Ejecutá los tests o build correspondientes.
- Al finalizar, informá archivos modificados, validaciones realizadas y riesgos pendientes.
- Esta ejecución puede ser un reintento.
- Revisá los cambios existentes antes de comenzar.
- Conservá cualquier trabajo parcial que sea correcto.
`;

    const result = await executeCodex({
      workingDirectory:
        worktree.agentWorkingPath,
      prompt,
    });

    const gitStatus =
      await getWorktreeStatus(
        worktree.worktreePath
      );

    const summary = [
      result.output,
      "",
      "ESTADO DEL WORKTREE:",
      gitStatus || "Sin cambios pendientes.",
      "",
      `Rama: ${task.branch_name}`,
      `Worktree: ${worktree.worktreePath}`,
    ].join("\n");

    const updatedTask = await pool.query(
      `
        UPDATE tasks
        SET status = 'review',
            result_summary = $2,
            execution_finished_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [
        task.id,
        summary.slice(-15000),
      ]
    );

    await finishTaskExecution({
      executionId,
      status: "passed",
      usage: result.usage,
      model: result.model,
    });
    executionId = null;

    await pool.query(
      `
        UPDATE agents
        SET status = 'idle',
            updated_at = NOW()
        WHERE id = $1
      `,
      [agent.id]
    );

    res.json(updatedTask.rows[0]);
  } catch (error) {
    console.error(
      "Error ejecutando Codex:",
      error
    );

    await pool.query(
      `
        UPDATE tasks
        SET status = 'failed',
            result_summary = $2,
            execution_finished_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        req.params.id,
        error.message.slice(-15000),
      ]
    );

    await finishTaskExecution({
      executionId,
      status: "failed",
      errorMessage: error.message,
    });

    if (agentId) {
      await pool.query(
        `
          UPDATE agents
          SET status = 'idle',
              updated_at = NOW()
          WHERE id = $1
        `,
        [agentId]
      );
    }

    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

router.post(
  "/:id/qa",
  async (req, res) => {
    let qaAgentId;
    let correctionAgentId;
    let cycleStarted = false;

    try {
      const taskResult = await pool.query(
        `
          SELECT
            t.*,
            p.frontend_path,
            p.backend_path
          FROM tasks t
          INNER JOIN projects p
            ON p.id = t.project_id
          WHERE t.id = $1
        `,
        [req.params.id]
      );

      const task = taskResult.rows[0];

      if (!task) {
        return res.status(404).json({
          status: "error",
          message: "Tarea no encontrada",
        });
      }

      if (task.status !== "review") {
        return res.status(409).json({
          status: "error",
          message:
            "La tarea debe estar en revisión para ejecutar QA",
        });
      }

      if (!task.agent_working_path) {
        return res.status(409).json({
          status: "error",
          message:
            "La tarea no tiene un directorio de trabajo",
        });
      }

      if (
        task.assigned_role === "fullstack" &&
        (!task.frontend_working_path ||
          !task.backend_working_path)
      ) {
        return res.status(409).json({
          status: "error",
          message:
            "La tarea fullstack no tiene rutas de trabajo frontend/backend guardadas. VolvÃ© a ejecutar el agente antes de ejecutar QA.",
        });
      }

      if (task.qa_status === "running") {
        return res.status(409).json({
          status: "error",
          message: "QA ya está ejecutándose",
        });
      }

      if (task.auto_correction_active) {
        return res.status(409).json({
          status: "error",
          message:
            "El ciclo automatico ya esta ejecutandose para esta tarea",
        });
      }

      const lockResult = await pool.query(
        `
          UPDATE tasks
          SET auto_correction_active = TRUE,
              auto_correction_stage = 'qa',
              auto_correction_finished_count = 0,
              correction_attempts = 0,
              updated_at = NOW()
          WHERE id = $1
            AND auto_correction_active = FALSE
          RETURNING *
        `,
        [task.id]
      );

      if (lockResult.rowCount === 0) {
        return res.status(409).json({
          status: "error",
          message:
            "El ciclo automatico ya esta ejecutandose para esta tarea",
        });
      }

      cycleStarted = true;

      const cycleAgentsResult = await pool.query(
        `
          SELECT *
          FROM agents
          WHERE role IN ('qa', $1)
            AND active = TRUE
        `,
        [task.assigned_role]
      );
      const agentsByRole = new Map(
        cycleAgentsResult.rows.map((agent) => [
          agent.role,
          agent,
        ])
      );
      const cycleQaAgent = agentsByRole.get("qa");
      const correctionAgent = agentsByRole.get(
        task.assigned_role
      );

      if (!cycleQaAgent) {
        throw new Error(
          "No existe un QA Agent activo"
        );
      }

      if (!correctionAgent) {
        throw new Error(
          "No existe un agente activo para corregir la tarea"
        );
      }

      qaAgentId = cycleQaAgent.id;
      correctionAgentId = correctionAgent.id;

      await pool.query(
        `
          UPDATE agents
          SET status = 'working',
              updated_at = NOW()
          WHERE id IN ($1, $2)
        `,
        [cycleQaAgent.id, correctionAgent.id]
      );

      let currentTask = lockResult.rows[0];
      let finalTask = currentTask;
      let previousFindings = null;
      let previousExecutionLeftChanges = Boolean(
        await getWorktreeStatus(task.worktree_path)
      );

      for (
        let qaAttempt = 1;
        qaAttempt <= MAX_AUTOMATIC_CORRECTIONS + 1;
        qaAttempt += 1
      ) {
        const qaAttemptResult =
          await runQaAttempt({
            task: currentTask,
            qaAgent: cycleQaAgent,
            attemptNumber: qaAttempt,
          });

        currentTask = qaAttemptResult.task;
        finalTask = currentTask;

        if (
          qaAttemptResult.qaResult.status ===
          "passed"
        ) {
          break;
        }

        const currentFindings =
          normalizeQaFindings(
            qaAttemptResult.qaResult.review ||
              qaAttemptResult.qaResult.summary
          );

        if (
          previousFindings &&
          currentFindings === previousFindings
        ) {
          const repeatedSummary = [
            currentTask.qa_summary,
            "",
            "CICLO AUTOMATICO DETENIDO:",
            "QA devolvio exactamente los mismos hallazgos que en el intento anterior.",
          ].join("\n");

          const repeatedResult =
            await pool.query(
              `
                UPDATE tasks
                SET status = 'review',
                    qa_status = 'failed',
                    qa_summary = $2,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *
              `,
              [
                currentTask.id,
                repeatedSummary.slice(-15000),
              ]
            );

          finalTask = repeatedResult.rows[0];
          break;
        }

        previousFindings = currentFindings;

        if (
          Number(currentTask.correction_attempts) >=
          MAX_AUTOMATIC_CORRECTIONS
        ) {
          break;
        }

        if (!previousExecutionLeftChanges) {
          const noChangesSummary = [
            currentTask.qa_summary,
            "",
            "CICLO AUTOMATICO DETENIDO:",
            "No se inicio una correccion porque la ejecucion anterior no dejo cambios.",
          ].join("\n");

          const noChangesResult =
            await pool.query(
              `
                UPDATE tasks
                SET status = 'review',
                    qa_status = 'failed',
                    qa_summary = $2,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *
              `,
              [
                currentTask.id,
                noChangesSummary.slice(-15000),
              ]
            );

          finalTask = noChangesResult.rows[0];
          break;
        }

        const correctionAttempt =
          Number(currentTask.correction_attempts) +
          1;
        const correctionAttemptResult =
          await runCorrectionAttempt({
            task: currentTask,
            agent: correctionAgent,
            qaSummary:
              qaAttemptResult.qaResult.summary,
            attemptNumber: correctionAttempt,
            statusBeforeCorrection:
              await getWorktreeStatus(
                currentTask.worktree_path
              ),
          });

        currentTask = correctionAttemptResult.task;
        finalTask = currentTask;
        previousExecutionLeftChanges =
          correctionAttemptResult.leftChanges;
      }

      if (
        finalTask.qa_status === "failed" &&
        Number(finalTask.correction_attempts) >=
          MAX_AUTOMATIC_CORRECTIONS
      ) {
        const maxAttemptsSummary = [
          finalTask.qa_summary,
          "",
          "CICLO AUTOMATICO DETENIDO:",
          `Se alcanzaron ${MAX_AUTOMATIC_CORRECTIONS} correcciones automaticas sin aprobar QA.`,
        ].join("\n");

        const maxAttemptsResult =
          await pool.query(
            `
              UPDATE tasks
              SET status = 'review',
                  qa_status = 'failed',
                  qa_summary = $2,
                  updated_at = NOW()
              WHERE id = $1
              RETURNING *
            `,
            [
              finalTask.id,
              maxAttemptsSummary.slice(-15000),
            ]
          );

        finalTask = maxAttemptsResult.rows[0];
      }

      await pool.query(
        `
          UPDATE agents
          SET status = 'idle',
              updated_at = NOW()
          WHERE id IN ($1, $2)
        `,
        [cycleQaAgent.id, correctionAgent.id]
      );

      const unlockedResult = await pool.query(
        `
          UPDATE tasks
          SET auto_correction_active = FALSE,
              auto_correction_stage = NULL,
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [finalTask.id]
      );

      return res.json(unlockedResult.rows[0]);
    } catch (error) {
      console.error(
        "Error ejecutando QA:",
        error
      );

      await pool.query(
        `
          UPDATE tasks
          SET qa_status = 'failed',
              qa_summary = $2,
              auto_correction_active = FALSE,
              auto_correction_stage = NULL,
              qa_finished_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          req.params.id,
          error.message.slice(-15000),
        ]
      );

      if (qaAgentId) {
        await pool.query(
          `
            UPDATE agents
            SET status = 'idle',
                updated_at = NOW()
            WHERE id = $1
          `,
          [qaAgentId]
        );
      }

      if (
        correctionAgentId &&
        correctionAgentId !== qaAgentId
      ) {
        await pool.query(
          `
            UPDATE agents
            SET status = 'idle',
                updated_at = NOW()
            WHERE id = $1
          `,
          [correctionAgentId]
        );
      }

      if (cycleStarted) {
        await pool.query(
          `
            UPDATE tasks
            SET auto_correction_active = FALSE,
                auto_correction_stage = NULL,
                updated_at = NOW()
            WHERE id = $1
          `,
          [req.params.id]
        );
      }

      res.status(500).json({
        status: "error",
        message: error.message,
      });
    }
  }
);

router.post(
  "/:id/reject",
  async (req, res) => {
    const notes =
      req.body?.notes?.trim();

    if (!notes) {
      return res.status(400).json({
        status: "error",
        message:
          "Las observaciones son obligatorias",
      });
    }

    try {
      const result = await pool.query(
        `
          UPDATE tasks
          SET qa_status = 'failed',
              review_feedback = $2,
              rejected_at = NOW(),
              result_summary =
                COALESCE(
                  result_summary,
                  ''
                )
                || $3,
              updated_at = NOW()
          WHERE id = $1
            AND status = 'review'
          RETURNING *
        `,
        [
          req.params.id,
          notes,
          `\n\nRECHAZO HUMANO:\n${notes}`,
        ]
      );

      if (result.rowCount === 0) {
        return res.status(409).json({
          status: "error",
          message:
            "La tarea no existe o no está en revisión",
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(
        "Error rechazando tarea:",
        error
      );

      res.status(500).json({
        status: "error",
        message:
          "No se pudo rechazar la tarea",
      });
    }
  }
);

router.post(
  "/:id/correct",
  async (req, res) => {
    let agentId;
    let executionId;

    try {
      const taskResult = await pool.query(
        `
          SELECT
            t.*,
            p.frontend_path,
            p.backend_path
          FROM tasks t
          INNER JOIN projects p
            ON p.id = t.project_id
          WHERE t.id = $1
        `,
        [req.params.id]
      );

      const task = taskResult.rows[0];

      if (!task) {
        return res.status(404).json({
          status: "error",
          message: "Tarea no encontrada",
        });
      }

      if (task.status !== "review") {
        return res.status(409).json({
          status: "error",
          message:
            "La tarea debe estar en revisión",
        });
      }

      if (!task.review_feedback) {
        return res.status(409).json({
          status: "error",
          message:
            "La tarea no tiene observaciones para corregir",
        });
      }

      if (!task.agent_working_path) {
        return res.status(409).json({
          status: "error",
          message:
            "La tarea no tiene un worktree activo",
        });
      }

      if (
        task.assigned_role === "fullstack" &&
        (!task.frontend_working_path ||
          !task.backend_working_path)
      ) {
        return res.status(409).json({
          status: "error",
          message:
            "La tarea fullstack no tiene rutas de trabajo frontend/backend guardadas. Volve a ejecutar el agente antes de corregir.",
        });
      }

      const agentResult = await pool.query(
        `
          SELECT *
          FROM agents
          WHERE role = $1
            AND active = TRUE
          LIMIT 1
        `,
        [task.assigned_role]
      );

      const agent = agentResult.rows[0];

      if (!agent) {
        return res.status(409).json({
          status: "error",
          message:
            "No existe un agente activo para corregir la tarea",
        });
      }

      agentId = agent.id;

      await pool.query(
        `
          UPDATE tasks
          SET status = 'running',
              qa_status = 'pending',
              qa_summary = NULL,
              execution_started_at = NOW(),
              execution_finished_at = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [task.id]
      );

      await pool.query(
        `
          UPDATE agents
          SET status = 'working',
              updated_at = NOW()
          WHERE id = $1
        `,
        [agent.id]
      );

      const execution =
        await startTaskExecution({
          taskId: task.id,
          agentId: agent.id,
          executionType: "correction",
          provider: agent.provider,
        });

      executionId = execution.id;

      let correctionAllowedPathsPrompt =
        buildAllowedPathsPrompt({
          assignedRole:
            task.assigned_role,
          agentWorkingDirectory:
            task.agent_working_path,
        });

      if (
        task.assigned_role === "fullstack"
      ) {
        correctionAllowedPathsPrompt =
          buildAllowedPathsPrompt({
            assignedRole:
              task.assigned_role,
            frontendWorkingDirectory:
              task.frontend_working_path,
            backendWorkingDirectory:
              task.backend_working_path,
            agentWorkingDirectory:
              task.agent_working_path,
          });
      }

      const prompt = `
Sos el ${agent.name} de Ingeniería del Sur.

Estás corrigiendo una implementación existente dentro del mismo git worktree.

TAREA ORIGINAL:
${task.title}

DESCRIPCIÓN ORIGINAL:
${
  task.description ||
  "Sin descripción adicional."
}

OBSERVACIONES HUMANAS OBLIGATORIAS:
${task.review_feedback}

RESULTADO QA ANTERIOR:
${
  task.qa_summary ||
  "No hay resultado QA disponible."
}

INSTRUCCIONES:
- Revisá los cambios existentes antes de modificar.
- Corregí específicamente las observaciones indicadas.
- Conservá las partes que ya funcionan correctamente.
- Trabajá solamente dentro del directorio asignado.
- No cambies de rama.
${correctionAllowedPathsPrompt}

- No hagas commit, push, merge ni deploy.
- No leas ni muestres archivos .env.
- Ejecutá lint, tests o build cuando correspondan.
- Informá qué corregiste y qué validaciones ejecutaste.
`;

      const correctionResult =
        await executeCodex({
          workingDirectory:
            task.agent_working_path,
          prompt,
          sandbox: "workspace-write",
        });

      const gitStatus =
        await getWorktreeStatus(
          task.worktree_path
        );

      const correctionSummary = [
        "",
        "",
        `=== CORRECCIÓN ${task.correction_count + 1} ===`,
        correctionResult.output,
        "",
        "ESTADO DEL WORKTREE:",
        gitStatus ||
          "Sin cambios pendientes.",
      ].join("\n");

      const updatedTask =
        await pool.query(
          `
            UPDATE tasks
            SET status = 'review',
                qa_status = 'pending',
correction_feedback = review_feedback,
review_feedback = NULL,
correction_count =
                  correction_count + 1,
                execution_finished_at = NOW(),
                result_summary =
                  COALESCE(
                    result_summary,
                    ''
                  )
                  || $2,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
          `,
          [
            task.id,
            correctionSummary.slice(
              -15000
            ),
          ]
        );

      await finishTaskExecution({
        executionId,
        status: "passed",
        usage: correctionResult.usage,
        model: correctionResult.model,
      });
      executionId = null;

      await pool.query(
        `
          UPDATE agents
          SET status = 'idle',
              updated_at = NOW()
          WHERE id = $1
        `,
        [agent.id]
      );

      res.json(updatedTask.rows[0]);
    } catch (error) {
      console.error(
        "Error corrigiendo tarea:",
        error
      );

      await pool.query(
        `
          UPDATE tasks
          SET status = 'review',
              qa_status = 'failed',
              result_summary =
                COALESCE(
                  result_summary,
                  ''
                )
                || $2,
              execution_finished_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          req.params.id,
          `\n\nERROR DE CORRECCIÓN:\n${error.message}`.slice(
            -15000
          ),
        ]
      );

      await finishTaskExecution({
        executionId,
        status: "failed",
        errorMessage: error.message,
      });

      if (agentId) {
        await pool.query(
          `
            UPDATE agents
            SET status = 'idle',
                updated_at = NOW()
            WHERE id = $1
          `,
          [agentId]
        );
      }

      res.status(500).json({
        status: "error",
        message: error.message,
      });
    }
  }
);

router.post(
  "/:id/approve",
  async (req, res) => {
    try {
      const taskResult = await pool.query(
        `
          SELECT *
          FROM tasks
          WHERE id = $1
        `,
        [req.params.id]
      );

      const task = taskResult.rows[0];

      if (!task) {
        return res.status(404).json({
          status: "error",
          message: "Tarea no encontrada",
        });
      }

      if (task.status !== "review") {
        return res.status(409).json({
          status: "error",
          message:
            `La tarea está en estado ${task.status}`,
        });
      }

      if (task.qa_status !== "passed") {
  return res.status(409).json({
    status: "error",
    message:
      "La tarea necesita QA aprobado antes de integrarse a main",
  });
}

      if (!task.worktree_path) {
        return res.status(409).json({
          status: "error",
          message:
            "La tarea no tiene un worktree asociado",
        });
      }

      const result =
        await finalizeTaskWorktree({
          worktreeRoot:
            task.worktree_path,
          branchName:
            task.branch_name,
          baseBranch:
            task.base_branch || "main",
          commitMessage:
            `Task ${task.id}: ${task.title}`,
        });

      const warning =
        result.warnings.length > 0
          ? result.warnings.join("\n")
          : null;

      const updatedTask =
        await pool.query(
          `
            UPDATE tasks
            SET status = 'passed',
                commit_hash = $2,
                approved_at = NOW(),
                cleanup_warning = $3,
                result_summary =
                  COALESCE(
                    result_summary,
                    ''
                  )
                  || $4::varchar,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
          `,
          [
            task.id,
            result.commitHash,
            warning,
            `\n\nAPROBACIÓN HUMANA:\nCommit ${result.commitHash} integrado a ${task.base_branch || "main"}.`,
          ]
        );

      res.json(
        updatedTask.rows[0]
      );
    } catch (error) {
      console.error(
        "Error aprobando tarea:",
        error
      );

      res.status(500).json({
        status: "error",
        message: error.message,
      });
    }
  }
);

export default router;
