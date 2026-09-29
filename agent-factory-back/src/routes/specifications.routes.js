import { Router } from "express";
import { refineSpecification } from "../services/specification.service.js";

const router = Router();

router.post("/analyze", async (req, res) => {
  try {
    const { idea, conversation = [] } = req.body || {};
    if (!Array.isArray(conversation)) {
      return res.status(400).json({ message: "conversation debe ser un array" });
    }
    const result = await refineSpecification({ idea, conversation });
    res.json(result);
  } catch (error) {
    console.error("[SPECIFICATION]", error);
    res.status(error.statusCode || 500).json({
      message: error.message || "No se pudo analizar la especificacion",
    });
  }
});

export default router;
