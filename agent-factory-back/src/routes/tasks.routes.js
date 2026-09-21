import { Router } from "express";
import { pool } from "../db.js";
import { executeCodex } from "../services/codex.service.js";

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
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'queued',
          $5,
          'main'
        )
        RETURNING *
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
    worktree = await prepareTaskWorktree({
      taskId: task.id,
      targetDirectory,
      branchName: task.branch_name,
      baseBranch:
        task.base_branch || "main",
    });

    await pool.query(
      `
        UPDATE tasks
        SET status = 'running',
            worktree_path = $2,
            execution_started_at = NOW(),
            execution_finished_at = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [task.id, worktree.worktreeRoot]
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