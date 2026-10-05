import { ensureProjectLaunchSchema } from "./schema-migration.service.js";
import { reconcileProjectProcesses } from "./project-process-manager.service.js";
import { recoverInterruptedTasks } from "./recovery.service.js";

// Orden obligatorio: el esquema de project_processes (migración 015) debe
// quedar garantizado antes de tocar esa tabla. reconcileProjectProcesses()
// falla con "relation does not exist" si se ejecuta primero contra una
// instalación que todavía no aplicó la migración.
export async function initializeBackend({
  ensureSchema = ensureProjectLaunchSchema,
  recoverTasks = recoverInterruptedTasks,
  reconcile = reconcileProjectProcesses,
} = {}) {
  await ensureSchema();

  const recovery = await recoverTasks();

  await reconcile();

  return recovery;
}
