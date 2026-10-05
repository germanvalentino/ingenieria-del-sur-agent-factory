const SENSITIVE_NAME_ALTERNATION =
  "(?:PG)?PASSWORD|PASSWD|PWD|SECRET|TOKEN|API[_-]?KEY|AUTHORIZATION|OAUTH|CREDENTIAL|CONNECTION_STRING|DATABASE_URL";
const SECRET_ENV_KEY_PATTERN = new RegExp(SENSITIVE_NAME_ALTERNATION, "i");
const CONNECTION_STRING_PATTERN = /(:\/\/[^:@/\s]+:)([^@/\s]+)(@)/g;
const KEY_VALUE_SECRET_PATTERN = new RegExp(
  `([A-Za-z0-9_.-]*(?:${SENSITIVE_NAME_ALTERNATION})[A-Za-z0-9_.-]*)\\s*[:=]\\s*\\S+`,
  "gi"
);
const BEARER_TOKEN_PATTERN = /\bBearer\s+\S+/gi;

function getKnownSecretValues() {
  return Object.entries(process.env)
    .filter(([key, value]) => SECRET_ENV_KEY_PATTERN.test(key) && value)
    .map(([, value]) => value);
}

export function redactSecrets(text) {
  if (!text) {
    return text;
  }

  let redacted = text;

  for (const value of getKnownSecretValues()) {
    if (value.length < 3) {
      continue;
    }

    redacted = redacted.split(value).join("[REDACTED]");
  }

  redacted = redacted.replace(CONNECTION_STRING_PATTERN, "$1[REDACTED]$3");
  redacted = redacted.replace(KEY_VALUE_SECRET_PATTERN, "$1=[REDACTED]");
  redacted = redacted.replace(BEARER_TOKEN_PATTERN, "Bearer [REDACTED]");

  return redacted;
}
