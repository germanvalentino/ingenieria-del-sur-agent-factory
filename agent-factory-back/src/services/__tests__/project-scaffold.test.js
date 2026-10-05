import test from "node:test";
import assert from "node:assert/strict";
import { buildBackendFiles } from "../project-scaffold.service.js";

test("el package.json generado para el backend no usa node --watch y sigue siendo JSON valido", () => {
  const files = buildBackendFiles("mi-proyecto");
  const raw = files["package.json"];

  assert.ok(!raw.includes("--watch"), "el package.json generado no debe contener --watch");

  const pkg = JSON.parse(raw);

  assert.equal(pkg.scripts.start, "node src/server.js");
  assert.ok(
    pkg.scripts.dev === undefined || pkg.scripts.dev === "node src/server.js",
    "el script dev debe ser 'node src/server.js' o no existir"
  );
});
