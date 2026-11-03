import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// Do not assume an existing node_modules is complete. Resolve direct dependencies
// from the worktree itself, never from Agent Factory's own installation.
export async function inspectWorktreeDependencies(workingDirectory) {
  const manifestPath = path.join(workingDirectory, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const required = Object.keys({
    ...(manifest.dependencies || {}),
    ...(manifest.devDependencies || {}),
  });
  const requireFromWorktree = createRequire(manifestPath);
  const missing = [];
  for (const name of required) {
    try {
      // Package resolution is preferable to checking the directory alone:
      // node_modules can exist after a partial or interrupted npm install.
      requireFromWorktree.resolve(name);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
      // Some ESM-only packages expose only an import entry. Verify their package
      // directory in that case; the package may be installed correctly.
      const packageDirectory = path.join(workingDirectory, 'node_modules', ...name.split('/'));
      try { await fs.access(path.join(packageDirectory, 'package.json')); }
      catch (accessError) {
        if (accessError.code !== 'ENOENT') throw accessError;
        missing.push(name);
      }
    }
  }
  return { missing, ready: missing.length === 0 };
}
