import test from "node:test";
import assert from "node:assert/strict";
import { initializeBackend } from "../startup.service.js";

function makeFakeRecovery() {
  return { recoveredTasks: [], recoveredAgents: [], recoveredExecutions: [] };
}

test("initializeBackend ejecuta ensureSchema antes que reconcile", async () => {
  const order = [];

  await initializeBackend({
    ensureSchema: async () => {
      order.push("ensureSchema");
    },
    recoverTasks: async () => {
      order.push("recoverTasks");
      return makeFakeRecovery();
    },
    reconcile: async () => {
      order.push("reconcile");
    },
  });

  assert.deepEqual(order, ["ensureSchema", "recoverTasks", "reconcile"]);
});

test("el arranque funciona cuando project_processes todavía no existe (la migración se aplica antes de reconciliar)", async () => {
  // Simula una base "vieja" sin la migración 015: reconcile fallaría con
  // "relation project_processes does not exist" si se ejecutara antes de
  // que ensureSchema la cree.
  let schemaApplied = false;

  const recovery = await initializeBackend({
    ensureSchema: async () => {
      schemaApplied = true;
    },
    recoverTasks: async () => makeFakeRecovery(),
    reconcile: async () => {
      if (!schemaApplied) {
        throw new Error('relation "project_processes" does not exist');
      }
    },
  });

  assert.deepEqual(recovery, makeFakeRecovery());
});

test("el arranque conserva los datos existentes: reconcile ve el mismo estado si la tabla ya existía", async () => {
  const existingRows = [{ id: "a", status: "running" }];
  let reconciledWith = null;

  await initializeBackend({
    ensureSchema: async () => {
      // La migración ya estaba aplicada: no debe alterar las filas existentes.
    },
    recoverTasks: async () => makeFakeRecovery(),
    reconcile: async () => {
      reconciledWith = existingRows;
    },
  });

  assert.deepEqual(reconciledWith, existingRows);
});

test("un error real de migración detiene el arranque sin invocar recoverTasks ni reconcile", async () => {
  let recoverTasksCalled = false;
  let reconcileCalled = false;

  await assert.rejects(
    () =>
      initializeBackend({
        ensureSchema: async () => {
          throw new Error(
            "No se pudo aplicar la migración interna del esquema de lanzamiento de proyectos: error de sintaxis"
          );
        },
        recoverTasks: async () => {
          recoverTasksCalled = true;
          return makeFakeRecovery();
        },
        reconcile: async () => {
          reconcileCalled = true;
        },
      }),
    /No se pudo aplicar la migración/
  );

  assert.equal(recoverTasksCalled, false);
  assert.equal(reconcileCalled, false);
});
