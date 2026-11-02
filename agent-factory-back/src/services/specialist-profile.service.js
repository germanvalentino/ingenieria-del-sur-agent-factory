const ROLE_PROFILES = {
  frontend: {
    title: "Especialista Frontend React",
    expertise: [
      "React y Vite",
      "Tailwind y CSS responsive",
      "accesibilidad y estados de interfaz",
      "integracion segura con APIs",
    ],
    validations: [
      "lint",
      "tests de componentes o logica afectada",
      "build de produccion",
      "revision responsive cuando cambia la interfaz",
    ],
  },
  backend: {
    title: "Especialista Backend Node.js",
    expertise: [
      "Node.js y Express",
      "PostgreSQL y migraciones idempotentes",
      "seguridad, concurrencia y manejo de errores",
      "contratos HTTP y compatibilidad hacia atras",
    ],
    validations: [
      "node --check o lint",
      "tests del servicio y rutas afectadas",
      "migraciones idempotentes cuando corresponda",
      "respuestas HTTP y rollback ante fallos",
    ],
  },
  fullstack: {
    title: "Especialista Fullstack",
    expertise: [
      "React, Vite y Tailwind",
      "Node.js, Express y PostgreSQL",
      "contratos API entre frontend y backend",
      "consistencia transaccional y experiencia de usuario",
    ],
    validations: [
      "lint, tests y build del frontend afectado",
      "sintaxis y tests del backend afectado",
      "compatibilidad del contrato API extremo a extremo",
      "migraciones y rollback cuando corresponda",
    ],
  },
  qa: {
    title: "Especialista QA de Software",
    expertise: [
      "criterios de aceptacion verificables",
      "regresiones funcionales y seguridad",
      "analisis estricto del diff",
      "separacion entre defecto e infraestructura",
    ],
    validations: [
      "evidencia reproducible para cada bloqueo",
      "resultado de validaciones deterministicas",
      "cobertura de cada criterio de aceptacion",
      "ausencia de ampliaciones de alcance",
    ],
  },
};

const CRITICAL_PATTERNS = [
  /\b(auth|oauth|password|secret|credential|bearer|access token|refresh token)\b/i,
  /\b(payment|pago|tarjeta|card|bank|banco|financ)\w*/i,
  /\b(production|produccion|deploy|despliegue)\b/i,
  /\b(concurren|race condition|deadlock|transaction)\w*/i,
  /\b(delete|drop|truncate|borrar|eliminar)\b/i,
];

const COMPLEX_PATTERNS = [
  /\b(migration|migracion|postgres|database|base de datos|schema)\b/i,
  /\b(api|endpoint|webhook|integration|integracion)\b/i,
  /\b(frontend|backend|fullstack)\b/i,
  /\b(worker|queue|cola|retry|reintento|recovery|recuperacion)\b/i,
  /\b(refactor|architecture|arquitectura)\b/i,
];

const SIMPLE_PATTERNS = [
  /\b(texto|label|titulo|color|copy|typo|espaciado)\b/i,
  /\b(readme|documentacion|comentario)\b/i,
];

function normalizedRole(role) {
  const value = String(role || "backend").trim().toLowerCase();
  return ROLE_PROFILES[value] ? value : "backend";
}

export function getSpecialistProfile(role) {
  const key = normalizedRole(role);
  return { role: key, ...ROLE_PROFILES[key] };
}

export function classifyTaskComplexity({
  role,
  title = "",
  description = "",
} = {}) {
  const text = `${title}\n${description}`;
  const acceptanceCriteria = (text.match(/\b(?:AC|RF)\d+\b/gi) || []).length;

  if (CRITICAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return "critical";
  }

  const complexSignals = COMPLEX_PATTERNS.filter((pattern) =>
    pattern.test(text)
  ).length;

  if (
    (normalizedRole(role) === "fullstack" && complexSignals >= 1) ||
    complexSignals >= 2 ||
    acceptanceCriteria >= 5 ||
    text.length > 5000
  ) {
    return "complex";
  }

  if (
    SIMPLE_PATTERNS.some((pattern) => pattern.test(text)) &&
    text.length < 800 &&
    acceptanceCriteria <= 1
  ) {
    return "simple";
  }

  return "normal";
}

function planningRules(complexity) {
  if (complexity === "simple") {
    return [
      "Confirma el archivo exacto y realiza el cambio minimo.",
      "No amplíes el alcance ni refactorices codigo no relacionado.",
    ];
  }

  if (complexity === "critical") {
    return [
      "Antes de editar, identifica invariantes, amenazas, rollback y compatibilidad.",
      "Define un plan por etapas y valida cada frontera de seguridad o transaccion.",
      "Agrega pruebas de exito, fallo y regresion para el escenario critico.",
    ];
  }

  return [
    "Antes de editar, relaciona cada criterio de aceptacion con archivos y pruebas.",
    "Define un plan breve y verifica dependencias directas antes de implementar.",
    "Evita cambios no relacionados y conserva compatibilidad existente.",
  ];
}

export function buildSpecialistGuidance({
  role,
  title,
  description,
  phase = "development",
} = {}) {
  const profile = getSpecialistProfile(role);
  const complexity = classifyTaskComplexity({ role, title, description });
  const phaseRule =
    phase === "correction"
      ? "Corrige unicamente bloqueantes demostrados; no reimplementes la tarea completa."
      : phase === "qa"
        ? "Exige evidencia concreta; dudas o mejoras opcionales no son bloqueantes."
        : "Implementa la solucion completa mas pequena que satisfaga los criterios.";

  return [
    "PERFIL ESPECIALISTA:",
    `- Rol tecnico: ${profile.title}`,
    `- Complejidad determinada: ${complexity}`,
    `- Areas de dominio: ${profile.expertise.join(", ")}`,
    "",
    "METODO DE TRABAJO OBLIGATORIO:",
    ...planningRules(complexity).map((rule) => `- ${rule}`),
    `- ${phaseRule}`,
    "- Si corriges un defecto reproducible, agrega o actualiza una prueba que impida su regreso.",
    "- No declares terminado sin asociar criterios, cambios y validaciones ejecutadas.",
    "",
    "EVIDENCIA MINIMA:",
    ...profile.validations.map((validation) => `- ${validation}`),
  ].join("\n");
}

