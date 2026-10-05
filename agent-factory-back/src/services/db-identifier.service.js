const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export function toDatabaseIdentifier(name) {
  const base = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 63)
    .replace(/_+$/g, "");

  const withPrefix = /^[a-z]/.test(base) ? base : `db_${base}`;

  return withPrefix.slice(0, 63) || "proyecto_db";
}

export function assertValidDatabaseIdentifier(identifier) {
  if (!IDENTIFIER_PATTERN.test(String(identifier || ""))) {
    throw new Error(
      `Identificador de base de datos inválido: ${identifier}`
    );
  }

  return identifier;
}
