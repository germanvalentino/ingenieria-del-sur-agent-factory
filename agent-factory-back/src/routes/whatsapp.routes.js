import { Router } from "express";
import { refineSpecification } from "../services/specification.service.js";
import {
  extractIncomingText,
  formatSpecificationForWhatsApp,
  getWhatsAppReplyTo,
  isWhatsAppConfigured,
  sendWhatsAppText,
} from "../services/whatsapp.service.js";
import {
  getWhatsAppSession,
  resetWhatsAppSession,
  saveWhatsAppSession,
} from "../services/whatsapp-session.service.js";

const router = Router();
const processedMessageIds = new Set();

router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    process.env.WHATSAPP_VERIFY_TOKEN &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

async function processIncomingMessage(incoming) {
  if (!incoming?.from || !incoming.text) return;
  if (processedMessageIds.has(incoming.messageId)) return;

  processedMessageIds.add(incoming.messageId);
  if (processedMessageIds.size > 1000) {
    processedMessageIds.clear();
    processedMessageIds.add(incoming.messageId);
  }

  // Mantiene el override necesario para el numero de prueba de Meta.
  // En produccion, sin WHATSAPP_TEST_RECIPIENT, responde a incoming.from.
  const replyTo = getWhatsAppReplyTo(incoming.from);

  if (incoming.text.toLowerCase() === "/reset") {
    resetWhatsAppSession(incoming.from);
    await sendWhatsAppText({
      to: replyTo,
      body: "Conversacion reiniciada. Contame que cambio o funcionalidad queres especificar.",
    });
    return;
  }

  const session = getWhatsAppSession(incoming.from);

  if (!session.idea || session.status === "READY") {
    session.idea = incoming.text;
    session.conversation = [];
    session.specification = null;
    session.status = "REFINING";
  } else {
    session.conversation.push({ role: "user", content: incoming.text });
  }

  saveWhatsAppSession(session);

  await sendWhatsAppText({
    to: replyTo,
    body: "🟡 Recibi tu solicitud. La estoy analizando...",
  });

  const result = await refineSpecification({
    idea: session.idea,
    conversation: session.conversation,
    attachments: [],
    onProgress: async (event) => {
      if (
        event?.stage === "functional-analysis" &&
        event?.status === "completed"
      ) {
        await sendWhatsAppText({
          to: replyTo,
          body: "🔵 Analisis funcional terminado. Estoy haciendo la revision tecnica...",
        });
      }

      if (
        event?.stage === "technical-review" &&
        event?.status === "completed"
      ) {
        await sendWhatsAppText({
          to: replyTo,
          body: "🟣 Revision tecnica terminada. Estoy consolidando la especificacion...",
        });
      }
    },
  });

  session.specification = result;
  session.status = result.status;

  if (result.status === "NEEDS_CLARIFICATION") {
    const questionText = (result.questions || []).join("\n");
    if (questionText) {
      session.conversation.push({ role: "assistant", content: questionText });
    }
  }

  saveWhatsAppSession(session);

  await sendWhatsAppText({
    to: replyTo,
    body: formatSpecificationForWhatsApp(result),
  });
}

router.post("/webhook", (req, res) => {
  // Meta necesita un 200 rapido. El procesamiento con LLM continua despues del ACK.
  res.sendStatus(200);

  if (!isWhatsAppConfigured()) return;

  const incoming = extractIncomingText(req.body);
  if (!incoming) return;

  processIncomingMessage(incoming).catch((error) => {
    console.error("[WHATSAPP]", error);
    sendWhatsAppText({
      to: getWhatsAppReplyTo(incoming.from),
      body: "No pude procesar el pedido en este momento. Podes volver a intentarlo.",
    }).catch((sendError) => console.error("[WHATSAPP_SEND_ERROR]", sendError));
  });
});

router.get("/status", (req, res) => {
  res.json({
    enabled: isWhatsAppConfigured(),
    phoneNumberIdConfigured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    verifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
    accessTokenConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    testRecipientConfigured: Boolean(process.env.WHATSAPP_TEST_RECIPIENT),
  });
});

export default router;
