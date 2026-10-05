import test from "node:test";
import assert from "node:assert/strict";
import { buildSafeNpmEnvironment } from "../process-exec.service.js";
import { redactSecrets } from "../project-process-manager.service.js";

function hasKeyCaseInsensitive(env, key) {
  return Object.keys(env).some((k) => k.toUpperCase() === key.toUpperCase());
}

test("buildSafeNpmEnvironment no incluye SCAFFOLD_PG_PASSWORD", () => {
  process.env.SCAFFOLD_PG_PASSWORD = "super-secreto-123";

  const env = buildSafeNpmEnvironment();

  assert.equal(hasKeyCaseInsensitive(env, "SCAFFOLD_PG_PASSWORD"), false);
  assert.ok(!Object.values(env).includes("super-secreto-123"));

  delete process.env.SCAFFOLD_PG_PASSWORD;
});

test("buildSafeNpmEnvironment no incluye variables sensibles arbitrarias del proceso padre", () => {
  process.env.MY_RANDOM_SECRET_TOKEN = "arbitrary-secret-value";
  process.env.WHATSAPP_API_TOKEN = "arbitrary-token-value";

  const env = buildSafeNpmEnvironment();

  assert.equal(hasKeyCaseInsensitive(env, "MY_RANDOM_SECRET_TOKEN"), false);
  assert.equal(hasKeyCaseInsensitive(env, "WHATSAPP_API_TOKEN"), false);

  delete process.env.MY_RANDOM_SECRET_TOKEN;
  delete process.env.WHATSAPP_API_TOKEN;
});

test("buildSafeNpmEnvironment conserva PATH y variables minimas necesarias en Windows", () => {
  const env = buildSafeNpmEnvironment();

  assert.ok(hasKeyCaseInsensitive(env, "PATH"));
});

test("redactSecrets oculta un password conocido presente en stderr", () => {
  process.env.SCAFFOLD_PG_PASSWORD = "mi-password-secreta";

  const stderr = "npm ERR! connection failed: mi-password-secreta was rejected";
  const redacted = redactSecrets(stderr);

  assert.ok(!redacted.includes("mi-password-secreta"));
  assert.ok(redacted.includes("[REDACTED]"));

  delete process.env.SCAFFOLD_PG_PASSWORD;
});

test("redactSecrets oculta contraseña dentro de una connection string", () => {
  const text = "Error connecting to postgres://admin:secretPass123@localhost:5432/db";
  const redacted = redactSecrets(text);

  assert.ok(!redacted.includes("secretPass123"));
  assert.ok(redacted.includes("postgres://admin:[REDACTED]@localhost:5432/db"));
});

test("redactSecrets oculta un Bearer token", () => {
  const text = "Authorization failed with Bearer abc123.def456-ghi789";
  const redacted = redactSecrets(text);

  assert.ok(!redacted.includes("abc123.def456-ghi789"));
  assert.ok(redacted.includes("Bearer [REDACTED]"));
});

test("redactSecrets no altera un mensaje normal de npm", () => {
  const text = "added 42 packages, and audited 43 packages in 5s\nfound 0 vulnerabilities";
  const redacted = redactSecrets(text);

  assert.equal(redacted, text);
});

test("redactSecrets oculta nombres de variables compuestos o prefijados", () => {
  const cases = [
    "MY_TOKEN=abc123secret",
    "NPM_CONFIG_TOKEN=abc123secret",
    "_authToken=abc123secret",
    "ACCESS_TOKEN=abc123secret",
    "SCAFFOLD_PG_PASSWORD=abc123secret",
  ];

  for (const line of cases) {
    const redacted = redactSecrets(line);
    assert.ok(!redacted.includes("abc123secret"), `deberia redactar: ${line}`);
    assert.ok(redacted.includes("[REDACTED]"), `deberia incluir marcador: ${line}`);
  }
});
