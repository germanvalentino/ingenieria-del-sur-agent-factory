import { Router } from "express";
import { existsSync } from "node:fs";
import { pool } from "../db.js";
import { executeCodex } from "../services/codex.service.js";
import { runQaValidation } from "../services/qa.service.js";

import {
  finalizeTaskWorktree,
  getWorktreeStatus,
  prepareTaskWorktree,
} from "../services/git-worktree.service.js";
const router = Router();

const VALID_ROLES = [
  "frontend",
  "backend",
  "qa",
];

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
          $4,
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
            WHEN $4 = 'frontend'
              THEN p.frontend_path IS NOT NULL
                AND TRIM(p.frontend_path) <> ''
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


router.post("/:id/run", async (req, res) => {
  let agentId;
  let worktree;

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

    if (!targetDirectory) {
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
  worktree = {
    worktreeRoot:
      task.worktree_path,
    agentWorkingDirectory:
      task.agent_working_path,
    branchName:
      task.branch_name,
    baseBranch:
      task.base_branch || "main",
  };

  console.log(
    `Reutilizando worktree para tarea ${task.id}: ${task.worktree_path}`
  );
} else {
  worktree =
    await prepareTaskWorktree({
      taskId: task.id,
      targetDirectory,
      branchName:
        task.branch_name,
      baseBranch:
        task.base_branch ||
        "main",
    });
}

    await pool.query(
      `
       UPDATE tasks
SET status = 'running',
    worktree_path = $2,
    agent_working_path = $3,
    qa_status = 'pending',
    execution_started_at = NOW(),
    execution_finished_at = NULL,
    updated_at = NOW()
WHERE id = $1
      `,
      [
  task.id,
  worktree.worktreeRoot,
  worktree.agentWorkingDirectory,
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
        worktree.agentWorkingDirectory,
      prompt,
    });

    const gitStatus =
      await getWorktreeStatus(
        worktree.worktreeRoot
      );

    const summary = [
      result.output,
      "",
      "ESTADO DEL WORKTREE:",
      gitStatus || "Sin cambios pendientes.",
      "",
      `Rama: ${task.branch_name}`,
      `Worktree: ${worktree.worktreeRoot}`,
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

      if (task.qa_status === "running") {
        return res.status(409).json({
          status: "error",
          message: "QA ya está ejecutándose",
        });
      }

      const agentResult = await pool.query(
        `
          SELECT *
          FROM agents
          WHERE role = 'qa'
            AND active = TRUE
          LIMIT 1
        `
      );

      const qaAgent = agentResult.rows[0];

      if (!qaAgent) {
        return res.status(409).json({
          status: "error",
          message:
            "No existe un QA Agent activo",
        });
      }

      qaAgentId = qaAgent.id;

      await pool.query(
        `
          UPDATE tasks
          SET qa_status = 'running',
              qa_started_at = NOW(),
              qa_finished_at = NULL,
              qa_summary = NULL,
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
        [qaAgent.id]
      );

     
const qaResult =
  await runQaValidation({
    workingDirectory:
      task.agent_working_path,
    taskTitle: task.title,
    taskDescription:
      task.description,
    correctionFeedback:
      task.correction_feedback,
  });
      const updatedTask =
        await pool.query(
          `
            UPDATE tasks
            SET qa_status = $2,
                qa_summary = $3,
                qa_finished_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
          `,
          [
            task.id,
            qaResult.status,
            qaResult.summary.slice(-15000),
          ]
        );

      await pool.query(
        `
          UPDATE agents
          SET status = 'idle',
              updated_at = NOW()
          WHERE id = $1
        `,
        [qaAgent.id]
      );

      res.json(updatedTask.rows[0]);
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
                  || $4,
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