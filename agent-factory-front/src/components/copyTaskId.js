export async function copyTaskId(id, clipboard = globalThis.navigator?.clipboard) {
  try {
    await clipboard.writeText(String(id));
    return "ID copiado";
  } catch {
    return "No se pudo copiar el ID";
  }
}
