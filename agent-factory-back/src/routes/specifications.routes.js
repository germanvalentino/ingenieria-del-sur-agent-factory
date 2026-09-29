import { Router } from "express";
import multer from "multer";
import { refineSpecification } from "../services/specification.service.js";
import {
  MAX_ATTACHMENTS,
  MAX_FILE_SIZE_BYTES,
  processPdfAttachments,
} from "../services/pdf-attachment.service.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES * 2,
    files: MAX_ATTACHMENTS * 2,
  },
});

function mapMulterError(error) {
  if (error.code === "LIMIT_FILE_SIZE") {
    return `Uno de los archivos supera el tamaño maximo permitido de ${
      MAX_FILE_SIZE_BYTES / (1024 * 1024)
    } MB.`;
  }

  if (error.code === "LIMIT_FILE_COUNT") {
    return `Se alcanzo el maximo de ${MAX_ATTACHMENTS} PDFs por solicitud.`;
  }

  return "No se pudieron procesar los archivos adjuntos.";
}

function handleUpload(req, res, next) {
  upload.array("pdfs", MAX_ATTACHMENTS * 2)(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({ message: mapMulterError(error) });
    }

    return next(error);
  });
}

router.post("/attachments/extract", handleUpload, async (req, res) => {
  try {
    const currentCount = Math.max(
      0,
      parseInt(req.body?.currentCount, 10) || 0
    );
    const results = await processPdfAttachments({
      files: req.files || [],
      currentCount,
    });
    res.json({ results });
  } catch (error) {
    console.error("[SPECIFICATION_ATTACHMENTS]", error);
    res.status(500).json({
      message: "No se pudieron procesar los archivos adjuntos.",
    });
  }
});

router.post("/analyze", async (req, res) => {
  try {
    const { idea, conversation = [], attachments = [] } = req.body || {};
    if (!Array.isArray(conversation)) {
      return res.status(400).json({ message: "conversation debe ser un array" });
    }
    if (!Array.isArray(attachments)) {
      return res.status(400).json({ message: "attachments debe ser un array" });
    }
    const result = await refineSpecification({
      idea,
      conversation,
      attachments: attachments.slice(0, MAX_ATTACHMENTS),
    });
    res.json(result);
  } catch (error) {
    console.error("[SPECIFICATION]", error);
    res.status(error.statusCode || 500).json({
      message: error.message || "No se pudo analizar la especificacion",
    });
  }
});

export default router;
