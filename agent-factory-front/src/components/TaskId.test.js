import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import { copyTaskId } from "./copyTaskId.js";

test("copia el ID completo y confirma solo despues de escribir", async () => {
  const id = "task-12345678-abcdef-1234-5678";
  let finish;
  let received;
  const pending = copyTaskId(id, { writeText(value) {
    received = value;
    return new Promise((resolve) => { finish = resolve; });
  } });
  assert.equal(received, id);
  finish();
  assert.equal(await pending, "ID copiado");
});

test("maneja rechazo o ausencia de acceso al portapapeles", async () => {
  assert.equal(await copyTaskId("task-1", { writeText: async () => { throw new Error("denied"); } }), "No se pudo copiar el ID");
  assert.equal(await copyTaskId("task-1", null), "No se pudo copiar el ID");
});

test("muestra ID completo, boton accesible y estilos adaptables en cada tarjeta", async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true } });
  try {
    const { default: TaskId } = await server.ssrLoadModule("/src/components/TaskId.jsx");
    const html = renderToStaticMarkup(createElement(TaskId, { id: "task-long-id-123456789" }));
    assert.match(html, /ID: task-long-id-123456789/);
    assert.match(html, /type="button"/);
    assert.match(html, /aria-label="Copiar ID de tarea task-long-id-123456789"/);
    assert.match(html, /role="status"/);
    for (const style of ["flex-wrap", "min-w-0", "break-all", "shrink-0", "focus-visible:outline"]) assert.ok(html.includes(style));
    const app = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
    assert.match(app, /<TaskId id=\{task.id\} \/>/);
  } finally {
    await server.close();
  }
});
