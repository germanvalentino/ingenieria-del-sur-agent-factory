const GRAPH_VERSION = process.env.WHATSAPP_API_VERSION || "v25.0";

export function isWhatsAppConfigured() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_VERIFY_TOKEN
  );
}

export function getWhatsAppReplyTo(incomingFrom) {
  const testRecipient = String(process.env.WHATSAPP_TEST_RECIPIENT || "").trim();
  return testRecipient || String(incomingFrom || "").trim();
}

export async function sendWhatsAppText({ to, body }) {
  if (!isWhatsAppConfigured()) {
    throw new Error("WhatsApp no esta configurado en el entorno");
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: String(to),
        type: "text",
        text: {
          preview_url: false,
          body: String(body).slice(0, 4096),
        },
      }),
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload?.error?.message || `WhatsApp Cloud API respondio HTTP ${response.status}`
    );
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

export function extractIncomingText(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  if (!message || message.type !== "text") return null;

  return {
    from: message.from,
    messageId: message.id,
    text: String(message.text?.body || "").trim(),
    profileName: value?.contacts?.[0]?.profile?.name || "",
  };
}

export function formatSpecificationForWhatsApp(result) {
  if (result.status === "NEEDS_CLARIFICATION") {
    const questions = (result.questions || [])
      .map((question, index) => `${index + 1}. ${question}`)
      .join("\n");
    return `Necesito aclarar algunos puntos antes de cerrar la especificacion:\n\n${questions}`;
  }

  const requirements = (result.requirements || []).join("\n");
  const acceptance = (result.acceptanceCriteria || []).join("\n");
  const constraints = (result.constraints || []).join("\n");
  const outOfScope = (result.outOfScope || []).join("\n");

  return [
    result.title ? `*${result.title}*` : "*Especificacion lista*",
    result.description || "",
    requirements ? `\n*Requisitos*\n${requirements}` : "",
    acceptance ? `\n*Criterios de aceptacion*\n${acceptance}` : "",
    constraints ? `\n*Restricciones*\n${constraints}` : "",
    outOfScope ? `\n*Fuera de alcance*\n${outOfScope}` : "",
    "\nResponde con una nueva solicitud para iniciar otra especificacion, o /reset para descartar esta conversacion.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4096);
}
