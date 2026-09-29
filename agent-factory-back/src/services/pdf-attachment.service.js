import { PasswordException, PDFParse } from "pdf-parse";

export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 50000;
export const MAX_EXTRACTED_PAGES = 30;

function looksLikePdf(buffer) {
  return buffer.subarray(0, 1024).includes("%PDF-");
}

function classifyExtractionError(error) {
  if (error instanceof PasswordException) {
    return "El PDF esta protegido con contraseña.";
  }

  return "El PDF esta dañado o no pudo procesarse.";
}

async function extractPdfText(buffer, fileName) {
  if (!looksLikePdf(buffer)) {
    return {
      fileName,
      status: "error",
      reason: "El archivo no es un PDF valido.",
    };
  }

  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    const allPages = result.pages || [];
    const pageLimitExceeded = allPages.length > MAX_EXTRACTED_PAGES;
    const pages = pageLimitExceeded
      ? allPages.slice(0, MAX_EXTRACTED_PAGES)
      : allPages;
    const text = pages
      .map((page) => String(page.text || "").trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();

    if (!text) {
      return {
        fileName,
        status: "error",
        reason:
          "El PDF no contiene texto extraible (posiblemente escaneado o basado en imagenes).",
      };
    }

    const charLimitExceeded = text.length > MAX_EXTRACTED_CHARS;
    const finalText = charLimitExceeded
      ? text.slice(0, MAX_EXTRACTED_CHARS)
      : text;

    if (pageLimitExceeded || charLimitExceeded) {
      const reasons = [];
      if (pageLimitExceeded) {
        reasons.push(`supera el limite de ${MAX_EXTRACTED_PAGES} paginas`);
      }
      if (charLimitExceeded) {
        reasons.push(
          `supera el limite de ${MAX_EXTRACTED_CHARS.toLocaleString(
            "es-AR"
          )} caracteres`
        );
      }

      return {
        fileName,
        status: "truncated",
        text: finalText,
        charCount: finalText.length,
        reason: `El documento ${reasons.join(
          " y "
        )}; se proceso el contenido truncado.`,
      };
    }

    return {
      fileName,
      status: "ok",
      text,
      charCount: text.length,
    };
  } catch (error) {
    return {
      fileName,
      status: "error",
      reason: classifyExtractionError(error),
    };
  } finally {
    await parser.destroy();
  }
}

export async function processPdfAttachments({ files = [], currentCount = 0 }) {
  const results = [];
  let acceptedCount = Math.max(0, currentCount);

  for (const file of files) {
    const fileName = file.originalname;

    if (acceptedCount >= MAX_ATTACHMENTS) {
      results.push({
        fileName,
        status: "rejected",
        reason: `Se alcanzo el maximo de ${MAX_ATTACHMENTS} PDFs por solicitud.`,
      });
      continue;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      results.push({
        fileName,
        status: "rejected",
        reason: `El archivo supera el tamaño maximo permitido de ${
          MAX_FILE_SIZE_BYTES / (1024 * 1024)
        } MB.`,
      });
      continue;
    }

    const extraction = await extractPdfText(file.buffer, fileName);
    results.push(extraction);

    if (extraction.status !== "error") {
      acceptedCount += 1;
    }
  }

  return results;
}
