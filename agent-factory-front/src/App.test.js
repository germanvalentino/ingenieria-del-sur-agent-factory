import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("el botón Actualizar datos tiene un tooltip descriptivo y conserva su comportamiento", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const header = source.match(/<header\b[\s\S]*?<\/header>/)?.[0];
  const refresh = header?.match(/<button\b[^>]*>[\s\S]*?Actualizar datos\s*<\/button>/)?.[0];

  assert.ok(refresh);
  assert.match(refresh, /title="Actualizar la información de proyectos, agentes y tareas del dashboard"/);
  assert.match(refresh, /type="button"/);
  assert.match(refresh, /onClick=\{refreshDashboard\}/);
  assert.match(refresh, /disabled=\{loading\}/);
});
test('el encabezado del formulario muestra "Crear una nueva tarea"', async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const form = source.match(/<form\b[^>]*>[\s\S]*?<\/form>/)?.[0];
  const heading = form?.match(/<h3\b[^>]*>([^<]*)<\/h3>/)?.[1].trim();

  assert.equal(heading, "Crear una nueva tarea");
});
