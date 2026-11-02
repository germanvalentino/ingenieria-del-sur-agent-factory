import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("el indicador distingue actividad, reposo y las métricas habituales", async () => {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
  });

  try {
    const { default: MetricCard } = await server.ssrLoadModule("/src/components/MetricCard.jsx");
    const icon = (props) => createElement("svg", props);
    const render = (value, execution = true) => renderToStaticMarkup(
      createElement(MetricCard, {
        title: "En ejecución", value, execution, icon, color: "text-violet-400",
      }),
    );

    for (const value of [1, 3]) {
      const html = render(value);
      assert.match(html, new RegExp(`${value} ${value === 1 ? "tarea en ejecución" : "tareas en ejecución"}`));
      assert.match(html, /role="status" aria-atomic="true"/);
      assert.match(html, /border-violet-400\/50/);
      assert.match(html, /<svg[^>]*class="[^"]*motion-safe:animate-spin"[^>]*aria-hidden="true"/);
      assert.match(html, /min-w-0/);
      assert.match(html, /break-words/);
    }

    const idle = render(0);
    assert.match(idle, /Sin tareas en ejecución/);
    assert.doesNotMatch(idle, /animate-spin|border-violet-400\/50/);

    const regular = render(3, false);
    assert.match(regular, />3<\/strong>/);
    assert.doesNotMatch(regular, /role="status"|animate-spin|border-violet-400\/50/);
  } finally {
    await server.close();
  }
});
