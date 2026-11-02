import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test('el encabezado del formulario muestra "Crear una nueva tarea"', async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const form = source.match(/<form\b[^>]*>[\s\S]*?<\/form>/)?.[0];
  const heading = form?.match(/<h3\b[^>]*>([^<]*)<\/h3>/)?.[1].trim();

  assert.equal(heading, "Crear una nueva tarea");
});
