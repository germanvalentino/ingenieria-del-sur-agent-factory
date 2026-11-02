import test from "node:test";
import assert from "node:assert/strict";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import { copyResult } from "./resultClipboard.js";

test("oculta Copiado a los 2 segundos y limpia efectos al reintentar y desmontar", async (t) => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true } });
  const dom = new JSDOM('<div id="root"></div>');
  const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const originals = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  let root;
  try {
    const { default: CopyResult } = await server.ssrLoadModule("/src/components/CopyResult.jsx");
    let write = async () => {};
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: { clipboard: { writeText: (text) => write(text) } }, IS_REACT_ACT_ENVIRONMENT: true })) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const container = document.getElementById("root");
    const mount = async () => {
      root = createRoot(container);
      await act(async () => root.render(createElement(StrictMode, null,
        createElement(CopyResult, { text: "Texto completo", label: "resultado" }))));
    };
    const click = () => act(async () => container.querySelector("button").click());
    const status = () => container.querySelector('[role="status"]').textContent;
    await mount();
    let received;
    write = async (text) => { received = text; };
    await click();
    assert.equal(received, "Texto completo");
    assert.equal(status(), "Copiado");
    await act(async () => t.mock.timers.tick(1999));
    assert.equal(status(), "Copiado");
    await act(async () => t.mock.timers.tick(1));
    assert.equal(status(), "");

    await click();
    await act(async () => t.mock.timers.tick(1000));
    await click();
    await act(async () => t.mock.timers.tick(1000));
    assert.equal(status(), "Copiado");
    await act(async () => t.mock.timers.tick(1000));
    assert.equal(status(), "");

    await click();
    write = async () => { throw new Error("denied"); };
    await click();
    await act(async () => t.mock.timers.tick(2000));
    assert.match(status(), /No se pudo copiar/);
    let finish;
    write = () => new Promise((resolve) => { finish = resolve; });
    await click();
    assert.equal(container.querySelector("button").disabled, true);
    await act(async () => root.unmount());
    const schedule = t.mock.method(globalThis, "setTimeout");
    await act(async () => finish());
    assert.equal(schedule.mock.callCount(), 0);

    await mount();
    write = async () => {};
    await click();
    const clear = t.mock.method(globalThis, "clearTimeout");
    await act(async () => root.unmount());
    assert.equal(clear.mock.callCount(), 1);
    await act(async () => t.mock.timers.tick(2000));
  } finally {
    t.mock.restoreAll();
    t.mock.timers.reset();
    await server.close();
    dom.window.close();
    globals.forEach((key, index) => {
      if (originals[index]) Object.defineProperty(globalThis, key, originals[index]);
      else delete globalThis[key];
    });
  }
});

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
