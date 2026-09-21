import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_EXECUTION_TIME = 15 * 60 * 1000;

export function executeCodex({ workingDirectory, prompt }) {
  return new Promise((resolve, reject) => {
    if (!path.isAbsolute(workingDirectory)) {
      reject(new Error("La ruta del proyecto no es absoluta"));
      return;
    }

    if (!fs.existsSync(workingDirectory)) {
      reject(
        new Error(
          `La ruta del proyecto no existe: ${workingDirectory}`
        )
      );
      return;
    }

    const allowedRoot = path.resolve("C:/proyectos");

    const resolvedDirectory = path.resolve(workingDirectory);

    if (!resolvedDirectory.startsWith(allowedRoot)) {
      reject(
        new Error(
          "Codex solamente puede trabajar dentro de C:/proyectos"
        )
      );
      return;
    }

    const child = spawn(
      "codex",
      [
        "exec",
        "--color",
        "never",
        "--ephemeral",
        "--sandbox",
        "workspace-write",
        "--cd",
        resolvedDirectory,
        "-",
      ],
      {
        cwd: resolvedDirectory,
        shell: true,
        windowsHide: true,
        env: process.env,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      console.log(`[CODEX] ${text}`);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      console.error(`[CODEX] ${text}`);
    });

    child.on("error", (error) => {
      reject(error);
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error("Codex superó el tiempo máximo de 15 minutos")
      );
    }, MAX_EXECUTION_TIME);

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        reject(
          new Error(
            stderr ||
              stdout ||
              `Codex finalizó con código ${code}`
          )
        );
        return;
      }

      resolve({
        exitCode: code,
        output: stdout.trim() || stderr.trim(),
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}