const sessions = new Map();

const SESSION_TTL_MS = Number(process.env.WHATSAPP_SESSION_TTL_MS || 24 * 60 * 60 * 1000);

function newSession(waId) {
  return {
    waId,
    idea: "",
    conversation: [],
    specification: null,
    status: "IDLE",
    updatedAt: Date.now(),
  };
}

export function getWhatsAppSession(waId) {
  const key = String(waId || "").trim();
  if (!key) return null;

  const current = sessions.get(key);
  if (current && Date.now() - current.updatedAt <= SESSION_TTL_MS) {
    return current;
  }

  const created = newSession(key);
  sessions.set(key, created);
  return created;
}

export function saveWhatsAppSession(session) {
  session.updatedAt = Date.now();
  sessions.set(session.waId, session);
  return session;
}

export function resetWhatsAppSession(waId) {
  const session = newSession(String(waId || "").trim());
  sessions.set(session.waId, session);
  return session;
}
