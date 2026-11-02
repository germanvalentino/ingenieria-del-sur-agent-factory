import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import { copyResult } from "./resultClipboard.js";

test("copia el resultado completo con saltos y confirma al finalizar", async () => {
  const text = `  Desarrollo\n\n${"resultado largo ".repeat(1000)}\r\nFin  `;
  let finish;
  let received;
  let completed = false;
  const pending = copyResult(text, { writeText(value) {
    received = value;
    return new Promise((resolve) => { finish = resolve; });
  } }).then((message) => { completed = true; return message; });
  assert.equal(received, text);
  await Promise.resolve();
  assert.equal(completed, false);
  finish();
  assert.equal(await pending, "Copiado");
});

test("cada grupo QA copia su propio texto y permite reintentar errores", async () => {
  const copied = [];
  const clipboard = { writeText: async (value) => { copied.push(value); } };
  for (const text of ["QA grupo 1\nAprobado", "QA grupo 2\nObservaciones"]) {
    assert.equal(await copyResult(text, clipboard), "Copiado");
  }
  assert.deepEqual(copied, ["QA grupo 1\nAprobado", "QA grupo 2\nObservaciones"]);
  assert.match(await copyResult("QA", null), /No se pudo copiar/);
  assert.match(await copyResult("QA", { writeText() { throw new Error("denied"); } }), /No se pudo copiar/);
  assert.match(await copyResult("QA", { writeText: async () => { throw new Error("denied"); } }), /No se pudo copiar/);
  assert.equal(await copyResult("QA", clipboard), "Copiado");
});

test("usa navigator.clipboard por defecto", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let received;
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      clipboard: { writeText: async (value) => { received = value; } },
    } });
    assert.equal(await copyResult("Texto\ncompleto"), "Copiado");
    assert.equal(received, "Texto\ncompleto");
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
});

test("botones accesibles y adaptables integrados a desarrollo y QA", async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true } });
  try {
    const { default: CopyResult } = await server.ssrLoadModule("/src/components/CopyResult.jsx");
    for (const label of ["resultado de desarrollo", "resultado QA"]) {
      const html = renderToStaticMarkup(createElement(CopyResult, { text: "Completo", label }));
      assert.ok(html.includes(`aria-label="Copiar ${label}"`));
      assert.match(html, /type="button"/);
      assert.match(html, />Copiar<\/button>/);
      assert.match(html, /role="status" aria-atomic="true"/);
      for (const style of ["flex-wrap", "max-w-full", "break-words", "shrink-0", "focus-visible:outline"]) assert.ok(html.includes(style));
    }
    const app = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
    for (const field of ["result_summary", "qa_summary"]) {
      assert.ok(app.includes(`text={task.${field}}`));
      assert.ok(app.includes(`key={task.${field}}`));
    }
  } finally {
    await server.close();
  }
});
