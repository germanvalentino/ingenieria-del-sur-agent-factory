import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Prefer an explicit executable when configured. Never execute through a shell.
export function resolveGitCommand(env = process.env, platform = process.platform) {
  const configured = env.AGENT_GIT_PATH?.trim();
  if (configured) {
    if (!fs.existsSync(configured)) throw new Error(`AGENT_GIT_PATH no existe: ${configured}`);
    return configured;
  }
  if (platform === "win32") {
    const candidates = [
      path.join(env.ProgramFiles || "C:/Program Files", "Git", "cmd", "git.exe"),
      path.join(env.ProgramFiles || "C:/Program Files", "Git", "bin", "git.exe"),
      path.join(env['ProgramFiles(x86)'] || "C:/Program Files (x86)", "Git", "cmd", "git.exe"),
    ];
    const found = candidates.find(candidate => fs.existsSync(candidate));
    if (found) return found;
  }
  return "git";
}

export async function executeGit(args, options = {}) {
  try {
    return await execFileAsync(resolveGitCommand(), args, { windowsHide: true, ...options, shell: false });
  } catch (error) {
    if (error.code === "ENOENT") {
      const wrapped = new Error(`No se pudo ejecutar Git (${error.message}). Configurá AGENT_GIT_PATH con la ruta completa de git.exe o verificá el PATH del backend.`);
      wrapped.code = error.code;
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }
}
