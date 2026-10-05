import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runProjectCreateAndStart } from "../project-launch.service.js";

const TEST_TMP_ROOT = path.join(process.cwd(), ".tmp-tests");

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

test("un fallo de npm install revierte solo la carpeta y base creadas por la operacion", async () => {
  const root = path.join(TEST_TMP_ROOT, `rollback npm ${Date.now()}`);
  const createdProjectRoot = path.join(root, "nuevo proyecto");
  const preexistingProjectRoot = path.join(root, "proyecto existente");
  const createdBackendPath = path.join(createdProjectRoot, "backend");
  const createdFrontendPath = path.join(createdProjectRoot, "frontend");
  const calls = {
    droppedDatabases: [],
    deletedProjectRows: [],
    rolledBackProjectRoots: [],
    stoppedProcesses: [],
  };

  await fs.mkdir(createdBackendPath, { recursive: true });
  await fs.mkdir(createdFrontendPath, { recursive: true });
  await fs.mkdir(preexistingProjectRoot, { recursive: true });
  await fs.writeFile(path.join(preexistingProjectRoot, "keep.txt"), "keep", "utf8");

  const fakePool = {
    async query(sql, params) {
      if (sql.includes("INSERT INTO projects")) {
        return {
          rows: [
            {
              id: 179,
              frontend_path: createdFrontendPath,
              backend_path: createdBackendPath,
            },
          ],
        };
      }

      if (sql.includes("DELETE FROM projects")) {
        calls.deletedProjectRows.push(params[0]);
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  try {
    await assert.rejects(
      () =>
        runProjectCreateAndStart({
          name: "Proyecto Rollback Npm",
          description: "test",
          projectPath: createdProjectRoot,
          repositoryUrl: "",
          defaultBranch: "main",
          __deps: {
            createProjectFromScratch: async () => ({
              projectPath: createdProjectRoot,
              frontendPath: createdFrontendPath,
              backendPath: createdBackendPath,
              createdDirs: {
                projectRoot: createdProjectRoot,
                parents: [],
              },
            }),
            rollbackScaffoldedProject: async (created) => {
              calls.rolledBackProjectRoots.push(created.createdDirs.projectRoot);
              await fs.rm(created.createdDirs.projectRoot, {
                recursive: true,
                force: true,
              });
            },
            databaseExists: async () => false,
            createDatabase: async () => {},
            dropDatabase: async (dbName) => {
              calls.droppedDatabases.push(dbName);
            },
            runSqlFile: async () => {},
            getScaffoldPgCredentials: () => ({
              host: "localhost",
              port: 5432,
              user: "postgres",
              password: "scaffold-password",
            }),
            runNpmInstall: async () => ({
              success: false,
              exitCode: 1,
              stdout: "",
              stderr: "npm ERR! password=scaffold-password\nnpm ERR! install failed",
              errorMessage: "npm failed with SCAFFOLD_PG_PASSWORD=scaffold-password",
            }),
            findFreePort: async () => 3100,
            startBackendProcess: async () => {
              throw new Error("no debe iniciar backend si falla npm install");
            },
            startFrontendProcess: async () => {
              throw new Error("no debe iniciar frontend si falla npm install");
            },
            stopProcess: async (projectId, processType) => {
              calls.stoppedProcesses.push({ projectId, processType });
            },
            pool: fakePool,
            execFileAsync: async () => {},
          },
        }),
      (error) => {
        assert.equal(error.message.includes("scaffold-password"), false);
        assert.ok(error.message.includes('"npm install" en backend'));
        assert.match(error.message, /\[REDACTED\]/);
        return true;
      }
    );

    assert.deepEqual(calls.droppedDatabases, ["proyecto_rollback_npm"]);
    assert.deepEqual(calls.deletedProjectRows, [179]);
    assert.deepEqual(calls.rolledBackProjectRoots, [createdProjectRoot]);
    assert.deepEqual(calls.stoppedProcesses, []);
    assert.equal(await pathExists(createdProjectRoot), false);
    assert.equal(await pathExists(preexistingProjectRoot), true);
    assert.equal(
      await fs.readFile(path.join(preexistingProjectRoot, "keep.txt"), "utf8"),
      "keep"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
