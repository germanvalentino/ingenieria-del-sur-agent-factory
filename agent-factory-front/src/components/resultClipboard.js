export async function copyResult(text, clipboard = globalThis.navigator?.clipboard) {
  try {
    await clipboard.writeText(text);
    return "Copiado";
  } catch {
    return "No se pudo copiar. Intentá nuevamente.";
  }
}
