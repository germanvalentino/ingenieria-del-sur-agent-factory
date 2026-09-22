import { Router } from "express";
import { pool } from "../db.js";
import { validateProjectPath } from "../services/project-validation.service.js";

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