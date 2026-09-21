import { Router } from "express";
import { pool } from "../db.js";
import { executeCodex } from "../services/codex.service.js";

const router = Router();

const VALID_ROLES = ["frontend", "backend", "qa"];

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

  if (!projectId || !title?.trim() || !assignedRole) {
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
          branch_name
        )
        VALUES ($1, $2, $3, $4, 'queued', $5)
        RETURNING *
      `,
      [
        projectId,
        title.trim(),
        description.trim(),
        assignedRole,
        createBranchName(assignedRole, title.trim()),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creando tarea:", error);

    res.status(500).json({
      status: "error",
      message: "No se pudo crear la tarea",
    });
  }
});

router.post("/:id/run", async (req, res) => {
  let agentId;

  try {
    const taskResult = await pool.query(
      `
        SELECT
          t.*,
          p.name AS project_name,
          p.frontend_path,
          p.backend_path
        FROM tasks t
        INNER JOIN projects p ON p.id = t.project_id
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
        message: `La tarea está en estado ${task.status}`,
      });
    }

    const workingDirectory =
      task.assigned_role === "frontend"
        ? task.frontend_path
        : task.backend_path;

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
        message: "No existe un agente activo para esta tarea",
      });
    }

    agentId = agent.id;

    await pool.query(
      `
        UPDATE tasks
        SET status = 'running',
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

PROYECTO:
${task.project_name}

ROL:
${task.assigned_role}

TAREA:
${task.title}

DESCRIPCIÓN Y CRITERIOS:
${task.description || "No se proporcionó descripción adicional."}

REGLAS OBLIGATORIAS:
- Trabajá únicamente dentro del directorio asignado.
- No hagas git commit.
- No hagas git push.
- No despliegues.
- No modifiques bases de datos de producción.
- No leas ni muestres archivos .env.
- Conservá el stack y la estructura existente.
- Ejecutá los tests o build que correspondan.
- Al terminar, informá archivos modificados, validaciones realizadas y riesgos pendientes.
`;

    const result = await executeCodex({
      workingDirectory,
      prompt,
    });

    const updatedTask = await pool.query(
      `
        UPDATE tasks
        SET status = 'review',
            result_summary = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [task.id, result.output.slice(-15000)]
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
    console.error("Error ejecutando Codex:", error);

    await pool.query(
      `
        UPDATE tasks
        SET status = 'failed',
            result_summary = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [req.params.id, error.message.slice(-15000)]
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

export default router;