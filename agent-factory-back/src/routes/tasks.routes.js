import { Router } from "express";
import { pool } from "../db.js";

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
    const branchName = createBranchName(
      assignedRole,
      title.trim()
    );

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
        branchName,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creando tarea:", error);

    if (error.code === "23503") {
      return res.status(400).json({
        status: "error",
        message: "El proyecto indicado no existe",
      });
    }

    res.status(500).json({
      status: "error",
      message: "No se pudo crear la tarea",
    });
  }
});

export default router;