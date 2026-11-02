import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpecialistGuidance,
  classifyTaskComplexity,
  getSpecialistProfile,
} from "../specialist-profile.service.js";

test("asigna el perfil tecnico correcto a cada rol", () => {
  assert.equal(getSpecialistProfile("frontend").role, "frontend");
  assert.match(getSpecialistProfile("backend").title, /Backend/);
  assert.match(getSpecialistProfile("fullstack").title, /Fullstack/);
  assert.match(getSpecialistProfile("qa").title, /QA/);
});

test("clasifica tareas simples sin sobredimensionarlas", () => {
  assert.equal(
    classifyTaskComplexity({
      role: "frontend",
      title: "Cambiar color del label",
      description: "Usar rojo en el titulo.",
    }),
    "simple"
  );
});

test("clasifica fullstack e integraciones como complejas", () => {
  assert.equal(
    classifyTaskComplexity({
      role: "fullstack",
      title: "Agregar endpoint y pantalla",
      description: "Integrar frontend y backend mediante API.",
    }),
    "complex"
  );
});

test("prioriza seguridad y pagos como criticidad alta", () => {
  assert.equal(
    classifyTaskComplexity({
      role: "backend",
      title: "Modificar autenticacion de pagos",
      description: "Actualizar token de tarjeta.",
    }),
    "critical"
  );
});

test("tokens de contexto de IA no se confunden con credenciales", () => {
  assert.equal(
    classifyTaskComplexity({
      role: "backend",
      title: "Reducir consumo de tokens",
      description: "Optimizar el contexto enviado al modelo.",
    }),
    "normal"
  );
});

test("la guia exige plan, validaciones y prueba de regresion", () => {
  const guidance = buildSpecialistGuidance({
    role: "backend",
    title: "Corregir un endpoint",
    description: "El endpoint falla.",
    phase: "correction",
  });

  assert.match(guidance, /PERFIL ESPECIALISTA/);
  assert.match(guidance, /plan breve/i);
  assert.match(guidance, /prueba que impida su regreso/i);
  assert.match(guidance, /unicamente bloqueantes demostrados/i);
});

