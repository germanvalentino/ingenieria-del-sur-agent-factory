import fs from "node:fs/promises";
import path from "node:path";
import {
  ALLOWED_ROOT,
  assertRealPathWithinAllowedRoot,
  normalizePath,
  validateAllowedPath,
} from "./project-validation.service.js";

const TEMP_PREFIX = ".agent-factory-scaffold-";

export class ExistingProjectPathError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ExistingProjectPathError";
    this.code = "EXISTING_PROJECT_PATH";
    this.details = details;
  }
}

function slugify(name) {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "proyecto";
}

async function pathExists(directory) {
  try {
    await fs.stat(directory);
    return true;
  } catch {
    return false;
  }
}

function assertSafeToRemove(targetPath) {
  if (!targetPath) {
    throw new Error("Ruta de limpieza vacía: operación cancelada por seguridad");
  }

  const resolved = path.resolve(targetPath);

  if (resolved === ALLOWED_ROOT) {
    throw new Error(
      "Operación cancelada: no se puede eliminar la carpeta raíz de proyectos"
    );
  }

  if (resolved !== ALLOWED_ROOT && !resolved.startsWith(`${ALLOWED_ROOT}${path.sep}`)) {
    throw new Error(
      "Operación cancelada: la ruta de limpieza está fuera de la carpeta de proyectos"
    );
  }

  return resolved;
}

async function safeRemoveTree(targetPath) {
  const resolved = assertSafeToRemove(targetPath);
  await fs.rm(resolved, { recursive: true, force: true });
}

/**
 * Crea únicamente los directorios padre faltantes de targetPath (no targetPath en sí).
 * Devuelve la lista de rutas efectivamente creadas por esta llamada, para poder
 * revertirlas si la operación falla más adelante.
 */
async function createMissingParentDirs(targetPath) {
  const parentDir = path.dirname(targetPath);
  const toCreate = [];
  let current = parentDir;

  while (!(await pathExists(current))) {
    toCreate.unshift(current);
    const parent = path.dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  const created = [];

  for (const dir of toCreate) {
    try {
      await fs.mkdir(dir);
      created.push(dir);
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      // Creado concurrentemente por otra operación: no nos pertenece.
    }
  }

  return created;
}

/**
 * Intenta eliminar, del más profundo al más superficial, cada directorio padre
 * creado por esta operación. Un directorio no vacío o ya inexistente no es un
 * error (puede pertenecer a otra operación concurrente). Cualquier otro fallo
 * se devuelve como advertencia en vez de silenciarse, para que el llamador lo
 * agregue a cleanup_warning.
 */
async function removeEmptyCreatedDirs(createdDirs) {
  const deepestFirst = [...createdDirs].reverse();
  const warnings = [];

  for (const dir of deepestFirst) {
    try {
      assertSafeToRemove(dir);
      await fs.rmdir(dir);
    } catch (error) {
      if (error.code === "ENOTEMPTY" || error.code === "ENOENT") {
        continue;
      }

      warnings.push(`No se pudo limpiar ${dir}: ${error.message}`);
    }
  }

  return warnings;
}

async function writeFiles(rootDir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(rootDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }
}

async function validateScaffold(tempDir, requiredFiles) {
  for (const relativePath of requiredFiles) {
    const fullPath = path.join(tempDir, relativePath);

    try {
      await fs.access(fullPath);
    } catch {
      throw new Error(
        `Falló la validación del proyecto generado: falta ${relativePath}`
      );
    }
  }
}

const FRONTEND_REQUIRED_FILES = [
  "package.json",
  "vite.config.js",
  "tailwind.config.js",
  "postcss.config.js",
  "index.html",
  "src/main.jsx",
  "src/App.jsx",
  "src/index.css",
];

const BACKEND_REQUIRED_FILES = [
  "package.json",
  "src/server.js",
  "src/db.js",
  "database/001-init.sql",
];

function buildFrontendFiles(slug) {
  return {
    "package.json": `${JSON.stringify(
      {
        name: `${slug}-front`,
        private: true,
        version: "0.1.0",
        type: "module",
        scripts: {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
        },
        dependencies: {
          react: "^18.3.1",
          "react-dom": "^18.3.1",
        },
        devDependencies: {
          "@vitejs/plugin-react": "^4.3.1",
          autoprefixer: "^10.4.19",
          postcss: "^8.4.38",
          tailwindcss: "^3.4.4",
          vite: "^5.3.1",
        },
      },
      null,
      2
    )}\n`,

    "vite.config.js": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`,

    "tailwind.config.js": `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
`,

    "postcss.config.js": `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,

    "index.html": `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${slug}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,

    "src/main.jsx": `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`,

    "src/App.jsx": `function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <h1 className="text-2xl font-semibold">Proyecto nuevo listo para comenzar</h1>
    </div>
  );
}

export default App;
`,

    "src/index.css": `@tailwind base;
@tailwind components;
@tailwind utilities;
`,

    ".gitignore": `node_modules
dist
.env
`,
  };
}

function buildBackendFiles(slug) {
  return {
    "package.json": `${JSON.stringify(
      {
        name: `${slug}-back`,
        private: true,
        version: "0.1.0",
        type: "module",
        scripts: {
          start: "node src/server.js",
          dev: "node --watch src/server.js",
        },
        dependencies: {
          cors: "^2.8.5",
          dotenv: "^16.4.5",
          express: "^4.19.2",
          pg: "^8.12.0",
        },
      },
      null,
      2
    )}\n`,

    "src/server.js": `import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./db.js";

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/db-health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS timestamp");

    res.json({ status: "ok", ...result.rows[0] });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(\`API escuchando en http://localhost:\${PORT}\`);
});
`,

    "src/db.js": `import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "",
  database: process.env.PGDATABASE || "postgres",
});
`,

    "database/001-init.sql": `-- Base inicial del proyecto generado.
-- Agregá acá las migraciones necesarias para tu dominio.
`,

    ".env.example": `PORT=3002
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=
PGDATABASE=${slug}
`,

    ".gitignore": `node_modules
.env
`,
  };
}

async function createTempScaffold(files, requiredFiles) {
  const tempDir = await fs.mkdtemp(path.join(ALLOWED_ROOT, TEMP_PREFIX));

  try {
    await writeFiles(tempDir, files);
    await validateScaffold(tempDir, requiredFiles);
    return tempDir;
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Crea un proyecto nuevo (frontend + backend) dentro de una única carpeta
 * destino (`projectPath`), tal como describe el requerimiento: una carpeta
 * de proyecto que contiene ambas partes. `projectPath` es la carpeta que el
 * sistema debe poseer por completo: se exige que no exista previamente, se
 * crea explícitamente como parte de esta operación y, ante cualquier fallo
 * posterior, se elimina entera (frontend + backend juntos) como una sola
 * unidad, sin depender de inferir un ancestro común entre rutas arbitrarias.
 */
export async function createProjectFromScratch({ name, projectPath }) {
  const resolvedRoot = validateAllowedPath(projectPath);

  if (resolvedRoot === ALLOWED_ROOT) {
    throw new ExistingProjectPathError(
      "Debés indicar una subcarpeta dentro de C:/proyectos para el proyecto nuevo, no la raíz."
    );
  }

  await assertRealPathWithinAllowedRoot(resolvedRoot);

  if (await pathExists(resolvedRoot)) {
    throw new ExistingProjectPathError(
      "La carpeta destino ya existe: se trata como proyecto existente (mantenimiento) y no se crea uno nuevo ahí.",
      { path: normalizePath(resolvedRoot) }
    );
  }

  const resolvedFrontend = path.join(resolvedRoot, "frontend");
  const resolvedBackend = path.join(resolvedRoot, "backend");
  const slug = slugify(name);

  const createdParentDirs = [];
  let projectRootCreatedByUs = false;
  let frontendTempDir = null;
  let backendTempDir = null;

  try {
    frontendTempDir = await createTempScaffold(
      buildFrontendFiles(slug),
      FRONTEND_REQUIRED_FILES
    );
    backendTempDir = await createTempScaffold(
      buildBackendFiles(slug),
      BACKEND_REQUIRED_FILES
    );

    createdParentDirs.push(...(await createMissingParentDirs(resolvedRoot)));

    try {
      await fs.mkdir(resolvedRoot);
      projectRootCreatedByUs = true;
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new ExistingProjectPathError(
          "La carpeta destino ya existe: se trata como proyecto existente (mantenimiento) y no se crea uno nuevo ahí.",
          { path: normalizePath(resolvedRoot) }
        );
      }

      throw error;
    }

    await fs.rename(frontendTempDir, resolvedFrontend);
    frontendTempDir = null;

    await fs.rename(backendTempDir, resolvedBackend);
    backendTempDir = null;

    return {
      projectPath: normalizePath(resolvedRoot),
      frontendPath: normalizePath(resolvedFrontend),
      backendPath: normalizePath(resolvedBackend),
      createdDirs: {
        projectRoot: resolvedRoot,
        parents: createdParentDirs,
      },
    };
  } catch (error) {
    const warnings = [];

    if (frontendTempDir) {
      await fs
        .rm(frontendTempDir, { recursive: true, force: true })
        .catch((cleanupError) => warnings.push(cleanupError.message));
    }

    if (backendTempDir) {
      await fs
        .rm(backendTempDir, { recursive: true, force: true })
        .catch((cleanupError) => warnings.push(cleanupError.message));
    }

    if (projectRootCreatedByUs) {
      // La carpeta destino fue creada por esta misma llamada: se elimina
      // entera (frontend + backend, publicados o no) como una sola unidad,
      // en vez de dejar un estado parcial según cuál rename haya fallado.
      await safeRemoveTree(resolvedRoot).catch((cleanupError) =>
        warnings.push(cleanupError.message)
      );
    }

    warnings.push(...(await removeEmptyCreatedDirs(createdParentDirs)));

    if (warnings.length > 0) {
      error.cleanupWarning = warnings.join("; ");
    }

    throw error;
  }
}

export async function rollbackScaffoldedProject({ createdDirs }) {
  const projectRoot = createdDirs?.projectRoot;
  const parents = createdDirs?.parents || [];
  const warnings = [];

  if (projectRoot) {
    await safeRemoveTree(projectRoot).catch((error) => warnings.push(error.message));
  }

  warnings.push(...(await removeEmptyCreatedDirs(parents)));

  if (warnings.length > 0) {
    const error = new Error(
      "No se pudo revertir completamente el proyecto generado"
    );
    error.cleanupWarning = warnings.join("; ");
    throw error;
  }
}
