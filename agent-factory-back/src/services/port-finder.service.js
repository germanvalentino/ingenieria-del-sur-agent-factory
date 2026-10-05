import net from "node:net";

const RESERVED_PORTS = new Set([3001, 5173]);

function checkPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

export async function isPortFree(port) {
  if (RESERVED_PORTS.has(Number(port))) {
    return false;
  }

  return checkPortFree(Number(port));
}

export async function findFreePort(startPort, { maxAttempts = 50 } = {}) {
  const start = Number(startPort);

  if (!Number.isInteger(start) || start <= 0 || start > 65535) {
    throw new Error(`Puerto inicial inválido: ${startPort}`);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = start + attempt;

    if (candidate > 65535) {
      break;
    }

    if (!RESERVED_PORTS.has(candidate) && (await checkPortFree(candidate))) {
      return candidate;
    }
  }

  throw new Error(
    `No se encontró un puerto libre a partir de ${start}`
  );
}
