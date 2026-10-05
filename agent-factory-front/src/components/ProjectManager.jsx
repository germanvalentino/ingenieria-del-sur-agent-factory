import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  FolderGit2,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  Rocket,
  Save,
  Square,
  X,
  XCircle,
} from "lucide-react";
import {
  LAUNCH_JOB_STORAGE_KEY,
  isActiveLaunchJob,
  resolveConflictingLaunchJob,
  resolveRestoredLaunchJob,
  shouldPollLaunchJob,
} from "./launchJobState.js";
import { createLaunchJobPoller } from "./launchJobPolling.js";

const PROJECTS_API = "http://localhost:3001/api/projects";

const EMPTY_FORM = {
  name: "",
  description: "",
  frontendPath: "",
  backendPath: "",
  projectPath: "",
  repositoryUrl: "",
  defaultBranch: "main",
};

const STAGE_NAMES = [
  "Generando estructura",
  "Inicializando Git",
  "Creando base PostgreSQL",
  "Instalando backend",
  "Instalando frontend",
  "Aplicando migraciones",
  "Iniciando backend",
  "Iniciando frontend",
  "Comprobando servicios",
];

function isAbortError(error) {
  return error?.name === "AbortError";
}

function StageIcon({ status }) {
  if (status === "completed") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />;
  }

  if (status === "failed") {
    return <XCircle className="h-4 w-4 shrink-0 text-red-400" />;
  }

  if (status === "running") {
    return (
      <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-sky-400" />
    );
  }

  return <Circle className="h-4 w-4 shrink-0 text-slate-600" />;
}

function ProjectManager({ onProjectsChanged }) {
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [mode, setMode] = useState("register");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [launchJob, setLaunchJob] = useState(null);
  const [processStatuses, setProcessStatuses] = useState({});
  const [processActionId, setProcessActionId] = useState(null);
  const isMountedRef = useRef(false);
  const createProjectControllerRef = useRef(null);
  const activeLaunchJob = isActiveLaunchJob(launchJob);

  async function loadProjects({ signal } = {}) {
    try {
      if (!isMountedRef.current || signal?.aborted) {
        return;
      }

      setLoading(true);
      setError("");

      const response = await fetch(PROJECTS_API, {
        cache: "no-store",
        signal,
      });

      if (!isMountedRef.current || signal?.aborted) {
        return;
      }

      const data = await response.json();

      if (!isMountedRef.current || signal?.aborted) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message || "No se pudieron cargar los proyectos");
      }

      setProjects(data);
    } catch (loadError) {
      if (isAbortError(loadError) || !isMountedRef.current || signal?.aborted) {
        return;
      }

      setError(loadError.message);
    } finally {
      if (isMountedRef.current && !signal?.aborted) {
        setLoading(false);
      }
    }
  }

  async function fetchLaunchJob(jobId, { signal } = {}) {
    const response = await fetch(`${PROJECTS_API}/jobs/${jobId}`, {
      cache: "no-store",
      signal,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "No se pudo consultar el estado de creacion");
    }

    return data;
  }

  async function loadLatestLaunchJob({ signal } = {}) {
    const response = await fetch(`${PROJECTS_API}/jobs/latest`, {
      cache: "no-store",
      signal,
    });

    if (response.status === 404) {
      return null;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "No se pudo recuperar la ultima creacion");
    }

    return data;
  }

  useEffect(() => {
    isMountedRef.current = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      loadProjects({ signal: controller.signal });
    }, 0);

    return () => {
      isMountedRef.current = false;
      createProjectControllerRef.current?.abort();
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function restoreLaunchJob() {
      try {
        const storedJobId = window.localStorage.getItem(LAUNCH_JOB_STORAGE_KEY);
        let restoredJob = null;

        if (storedJobId) {
          try {
            restoredJob = await fetchLaunchJob(storedJobId, {
              signal: controller.signal,
            });
          } catch (fetchError) {
            if (isAbortError(fetchError) || controller.signal.aborted) {
              return;
            }
          }
        }

        if (cancelled || !isMountedRef.current || controller.signal.aborted) {
          return;
        }

        const latestLaunchJob = await loadLatestLaunchJob({
          signal: controller.signal,
        });

        if (cancelled || !isMountedRef.current || controller.signal.aborted) {
          return;
        }

        const latestJob = resolveRestoredLaunchJob(
          restoredJob,
          latestLaunchJob,
        );

        if (cancelled || !isMountedRef.current || !latestJob) {
          return;
        }

        setLaunchJob(latestJob);
        setSaving(isActiveLaunchJob(latestJob));
        window.localStorage.setItem(LAUNCH_JOB_STORAGE_KEY, latestJob.jobId);
      } catch (restoreError) {
        if (
          !isAbortError(restoreError) &&
          !cancelled &&
          isMountedRef.current &&
          !controller.signal.aborted
        ) {
          setError(restoreError.message);
        }
      }
    }

    restoreLaunchJob();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  async function loadProcessStatus(projectId, { signal } = {}) {
    try {
      const response = await fetch(`${PROJECTS_API}/${projectId}/processes`, {
        cache: "no-store",
        signal,
      });

      if (!isMountedRef.current || signal?.aborted) {
        return;
      }

      const data = await response.json();

      if (!isMountedRef.current || signal?.aborted) {
        return;
      }

      if (response.ok) {
        setProcessStatuses((current) => ({
          ...current,
          [projectId]: data,
        }));
      }
    } catch (statusError) {
      if (isAbortError(statusError)) {
        return;
      }

      // El estado de procesos es informativo: un fallo de red no es crítico.
    }
  }

  useEffect(() => {
    if (projects.length === 0) {
      return undefined;
    }

    let cancelled = false;
    let timeoutId = null;
    const controller = new AbortController();

    async function pollProcessStatuses() {
      if (cancelled || !isMountedRef.current || controller.signal.aborted) {
        return;
      }

      await Promise.all(
        projects.map((project) =>
          loadProcessStatus(project.id, { signal: controller.signal }),
        ),
      );

      if (cancelled || !isMountedRef.current || controller.signal.aborted) {
        return;
      }

      timeoutId = setTimeout(pollProcessStatuses, 4000);
    }

    pollProcessStatuses();

    return () => {
      cancelled = true;
      controller.abort();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [projects]);

  useEffect(() => {
    if (!shouldPollLaunchJob(launchJob)) {
      return undefined;
    }

    const jobId = launchJob.jobId;

    const poller = createLaunchJobPoller({
      jobId,
      fetchLaunchJob,
      isMounted: () => isMountedRef.current,
      onJob: async (data) => {
        setLaunchJob(data);
        window.localStorage.setItem(LAUNCH_JOB_STORAGE_KEY, data.jobId);
      },
      onFinished: async (data, signal) => {
        setSaving(false);

        if (data.status === "completed") {
          setForm(EMPTY_FORM);
        }

        await loadProjects({ signal });

        if (!isMountedRef.current || signal.aborted) {
          return;
        }

        if (onProjectsChanged) {
          await onProjectsChanged();
        }
      },
      onError: async (pollError) => {
        setError(pollError.message);
        setSaving(false);
      },
    });

    return () => {
      poller.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchJob?.jobId]);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function startEditing(project) {
    setEditingId(project.id);
    setMode("register");

    setForm({
      name: project.name || "",
      description: project.description || "",
      frontendPath: project.frontend_path || "",
      backendPath: project.backend_path || "",
      repositoryUrl: project.repository_url || "",
      defaultBranch: project.default_branch || "main",
    });

    setError("");
  }

  function cancelEditing() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
  }

  function selectMode(nextMode) {
    setMode(nextMode);
    setForm(EMPTY_FORM);
    setError("");

    if (!isActiveLaunchJob(launchJob)) {
      setLaunchJob(null);
    }
  }

  async function createProject(autoStart) {
    if (!form.name.trim() || !form.projectPath.trim()) {
      setError("Completá el nombre y la carpeta del proyecto");
      return;
    }

    let controller = null;

    try {
      createProjectControllerRef.current?.abort();
      controller = new AbortController();
      createProjectControllerRef.current = controller;

      setSaving(true);
      setError("");
      setLaunchJob(
        autoStart
          ? {
              jobId: null,
              status: "running",
              stages: STAGE_NAMES.map((name) => ({
                name,
                status: "pending",
                message: null,
              })),
              result: null,
              error: null,
            }
          : null,
      );

      const response = await fetch(`${PROJECTS_API}/scaffold`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          projectPath: form.projectPath,
          repositoryUrl: form.repositoryUrl,
          defaultBranch: form.defaultBranch,
          autoStart,
        }),
        signal: controller.signal,
      });

      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      const data = await response.json();

      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      if (!response.ok && response.status === 409 && data.mode === "job") {
        const existingJob = await resolveConflictingLaunchJob(
          data,
          fetchLaunchJob,
          controller.signal,
        );

        if (!isMountedRef.current || controller.signal.aborted) {
          return;
        }

        window.localStorage.setItem(LAUNCH_JOB_STORAGE_KEY, existingJob.jobId);
        setLaunchJob(existingJob);
        setSaving(isActiveLaunchJob(existingJob));
        setError("");
        return;
      }

      if (!response.ok) {
        throw new Error(data.message || "No se pudo crear el proyecto");
      }

      if (data.mode === "job") {
        window.localStorage.setItem(LAUNCH_JOB_STORAGE_KEY, data.jobId);
        setLaunchJob((current) => ({ ...current, jobId: data.jobId }));
        return;
      }

      setForm(EMPTY_FORM);
      setMode("register");
      await loadProjects({ signal: controller.signal });

      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      if (onProjectsChanged) {
        await onProjectsChanged();
      }

      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      setSaving(false);
    } catch (createError) {
      if (isAbortError(createError) || !isMountedRef.current) {
        return;
      }

      setError(createError.message);
      setSaving(false);
      setLaunchJob(null);
    } finally {
      if (createProjectControllerRef.current === controller) {
        createProjectControllerRef.current = null;
      }
    }
  }

  async function runProcessAction(projectId, action) {
    try {
      setProcessActionId(`${projectId}:${action}`);
      setError("");

      const response = await fetch(`${PROJECTS_API}/${projectId}/${action}`, {
        method: "POST",
      });

      if (!isMountedRef.current) {
        return;
      }

      const data = await response.json();

      if (!isMountedRef.current) {
        return;
      }

      if (!response.ok) {
        throw new Error(
          data.message || `No se pudo ejecutar la acción: ${action}`,
        );
      }

      await loadProcessStatus(projectId);
    } catch (actionError) {
      if (!isMountedRef.current) {
        return;
      }

      setError(actionError.message);
    } finally {
      if (isMountedRef.current) {
        setProcessActionId(null);
      }
    }
  }

  async function saveProject(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setError("");

      const isEditing = Boolean(editingId);
      const isScaffolding = !isEditing && mode === "create";

      const url = isEditing
        ? `${PROJECTS_API}/${editingId}`
        : isScaffolding
          ? `${PROJECTS_API}/scaffold`
          : PROJECTS_API;

      const body = isScaffolding
        ? {
            name: form.name,
            description: form.description,
            projectPath: form.projectPath,
            repositoryUrl: form.repositoryUrl,
            defaultBranch: form.defaultBranch,
          }
        : form;

      const response = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!isMountedRef.current) {
        return;
      }

      const data = await response.json();

      if (!isMountedRef.current) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message || "No se pudo guardar el proyecto");
      }

      cancelEditing();
      setMode("register");
      await loadProjects();

      if (!isMountedRef.current) {
        return;
      }

      if (onProjectsChanged) {
        await onProjectsChanged();
      }
    } catch (saveError) {
      if (!isMountedRef.current) {
        return;
      }

      setError(saveError.message);
    } finally {
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  }

  async function toggleProject(project) {
    try {
      setError("");

      const response = await fetch(
        `${PROJECTS_API}/${project.id}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            active: !project.active,
          }),
        },
      );

      if (!isMountedRef.current) {
        return;
      }

      const data = await response.json();

      if (!isMountedRef.current) {
        return;
      }

      if (!response.ok) {
        throw new Error(
          data.message || "No se pudo cambiar el estado del proyecto",
        );
      }

      await loadProjects();

      if (!isMountedRef.current) {
        return;
      }

      if (onProjectsChanged) {
        await onProjectsChanged();
      }
    } catch (statusError) {
      if (!isMountedRef.current) {
        return;
      }

      setError(statusError.message);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-white/10 bg-slate-900/70 p-6 shadow-xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-5 w-5 text-cyan-400" />

            <h2 className="text-xl font-semibold text-white">
              Administración de proyectos
            </h2>
          </div>

          <p className="mt-1 text-sm text-slate-400">
            Registrá los proyectos que podrán utilizar los agentes.
          </p>
        </div>

        {editingId && (
          <button
            type="button"
            onClick={cancelEditing}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
          >
            <X className="h-4 w-4" />
            Cancelar edición
          </button>
        )}
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!editingId && (
        <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-slate-950/50 p-1">
          <button
            type="button"
            onClick={() => selectMode("register")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${
              mode === "register"
                ? "bg-cyan-500/20 text-cyan-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Registrar proyecto existente
          </button>

          <button
            type="button"
            onClick={() => selectMode("create")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${
              mode === "create"
                ? "bg-cyan-500/20 text-cyan-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Crear proyecto nuevo desde cero
          </button>
        </div>
      )}

      {!editingId && mode === "create" && (
        <p className="mb-5 text-sm text-slate-400">
          Se genera un proyecto base con React + Tailwind (frontend) y
          Express + Node.js + PostgreSQL (backend) dentro de la carpeta
          indicada. Esa carpeta no debe existir todavía: si ya existe, el
          sistema la trata como mantenimiento y no crea nada nuevo ahí.
        </p>
      )}

      <form
        onSubmit={saveProject}
        className="mb-8 grid gap-4 rounded-xl border border-white/10 bg-slate-950/50 p-5 md:grid-cols-2"
      >
        <label className="text-sm text-slate-300">
          Nombre
          <input
            required
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="Ejemplo: Agent Factory"
            className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none transition focus:border-cyan-500"
          />
        </label>

        <label className="text-sm text-slate-300">
          Rama principal
          <input
            name="defaultBranch"
            value={form.defaultBranch}
            onChange={handleChange}
            placeholder="main"
            className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none transition focus:border-cyan-500"
          />
        </label>

        <label className="text-sm text-slate-300 md:col-span-2">
          Descripción
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
            rows="2"
            placeholder="Descripción breve del proyecto"
            className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none transition focus:border-cyan-500"
          />
        </label>

        {!editingId && mode === "create" ? (
          <label className="text-sm text-slate-300 md:col-span-2">
            Carpeta del proyecto
            <input
              required
              name="projectPath"
              value={form.projectPath}
              onChange={handleChange}
              placeholder="C:/proyectos/mi-proyecto-nuevo"
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none transition focus:border-cyan-500"
            />
          </label>
        ) : (
          <>
            <label className="text-sm text-slate-300">
              Carpeta frontend
              <input
                name="frontendPath"
                value={form.frontendPath}
                onChange={handleChange}
                placeholder="C:/proyectos/mi-proyecto/front"
                className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none transition focus:border-cyan-500"
              />
            </label>

            <label className="text-sm text-slate-300">
              Carpeta backend
              <input
                name="backendPath"
                value={form.backendPath}
                onChange={handleChange}
                placeholder="C:/proyectos/mi-proyecto/back"
                className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none transition focus:border-cyan-500"
              />
            </label>
          </>
        )}

        <label className="text-sm text-slate-300 md:col-span-2">
          URL del repositorio
          <input
            name="repositoryUrl"
            value={form.repositoryUrl}
            onChange={handleChange}
            placeholder="https://github.com/usuario/repositorio.git"
            className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none transition focus:border-cyan-500"
          />
        </label>

        <div className="flex flex-wrap gap-3 md:col-span-2">
          {!editingId && mode === "create" ? (
            <>
              <button
                type="button"
                onClick={() => createProject(false)}
                disabled={saving || activeLaunchJob}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/40 px-5 py-2.5 font-semibold text-cyan-300 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {saving && !launchJob ? "Creando..." : "Crear solamente"}
              </button>

              <button
                type="button"
                onClick={() => createProject(true)}
                disabled={saving || activeLaunchJob}
                style={{
                  backgroundColor: "#06b6d4",
                  color: "#020617",
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-300 px-5 py-2.5 font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Rocket className="h-4 w-4" />
                {saving && launchJob ? "Creando e iniciando..." : "Crear e iniciar"}
              </button>
            </>
          ) : (
            <button
              type="submit"
              disabled={saving}
              style={{
                backgroundColor: "#06b6d4",
                color: "#020617",
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-300 px-5 py-2.5 font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editingId ? (
                <Save className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}

              {saving
                ? "Guardando..."
                : editingId
                  ? "Guardar cambios"
                  : "Agregar proyecto"}
            </button>
          )}
        </div>
      </form>

      {launchJob && (
        <div className="mb-8 rounded-xl border border-white/10 bg-slate-950/50 p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">
            Progreso de creación e inicio
          </h3>

          <ol className="space-y-2">
            {launchJob.stages.map((stage) => (
              <li key={stage.name} className="flex items-start gap-3 text-sm">
                <StageIcon status={stage.status} />

                <div>
                  <span
                    className={
                      stage.status === "failed"
                        ? "text-red-300"
                        : stage.status === "completed"
                          ? "text-emerald-300"
                          : stage.status === "running"
                            ? "text-sky-300"
                            : "text-slate-500"
                    }
                  >
                    {stage.name}
                  </span>

                  {stage.status === "failed" && stage.message && (
                    <p className="mt-1 text-xs text-red-400">
                      {stage.message}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {launchJob.status === "completed" && launchJob.result && (
            <div className="mt-4 space-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              <p className="font-semibold">
                Proyecto creado e iniciado correctamente
              </p>

              <p className="break-all">
                Frontend:{" "}
                <a
                  className="underline"
                  href={launchJob.result.frontendUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {launchJob.result.frontendUrl}
                </a>
              </p>

              <p className="break-all">
                Backend:{" "}
                <a
                  className="underline"
                  href={launchJob.result.backendUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {launchJob.result.backendUrl}
                </a>
              </p>

              <p>
                Base PostgreSQL:{" "}
                {launchJob.result.databaseName || launchJob.result.dbName}
              </p>

              <div className="flex flex-wrap gap-2 pt-2">
                <a
                  className="inline-flex items-center justify-center rounded-lg border border-emerald-300/40 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/10"
                  href={launchJob.result.frontendUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir frontend
                </a>

                <a
                  className="inline-flex items-center justify-center rounded-lg border border-emerald-300/40 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/10"
                  href={`${launchJob.result.backendUrl}/api/health`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Salud backend
                </a>

                <a
                  className="inline-flex items-center justify-center rounded-lg border border-emerald-300/40 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/10"
                  href={`${launchJob.result.backendUrl}/api/db-health`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Salud PostgreSQL
                </a>
              </div>
              <p>Dependencias instaladas: Sí</p>
              <p>Migraciones aplicadas: Sí</p>
            </div>
          )}

          {launchJob.status === "failed" && launchJob.error && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
              <p className="font-semibold">
                No se pudo completar la creación e inicio
              </p>

              <p className="mt-2">{launchJob.error.message}</p>

              {launchJob.error.cleanupWarning && (
                <p className="mt-2 text-xs text-amber-300">
                  Advertencia de limpieza: {launchJob.error.cleanupWarning}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Cargando proyectos...</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-slate-400">
          Todavía no hay proyectos registrados.
        </p>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <article
              key={project.id}
              className="flex flex-col gap-4 rounded-xl border border-white/10 bg-slate-950/40 p-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-white">
                    {project.name}
                  </h3>

                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      project.active
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-slate-500/15 text-slate-400"
                    }`}
                  >
                    {project.active ? "Activo" : "Inactivo"}
                  </span>
                </div>

                {project.description && (
                  <p className="mt-1 text-sm text-slate-400">
                    {project.description}
                  </p>
                )}

                <div className="mt-3 space-y-1 text-xs text-slate-500">
                  {project.frontend_path && (
                    <p className="break-all">
                      Frontend: {project.frontend_path}
                    </p>
                  )}

                  {project.backend_path && (
                    <p className="break-all">
                      Backend: {project.backend_path}
                    </p>
                  )}

                  <p>Rama: {project.default_branch}</p>
                </div>

                {(() => {
                  const status = processStatuses[project.id];
                  const backend = status?.backend;
                  const frontend = status?.frontend;

                  if (!backend && !frontend) {
                    return null;
                  }

                  return (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`rounded-full px-2 py-1 ${
                          backend?.status === "running"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-slate-500/15 text-slate-400"
                        }`}
                      >
                        Backend: {backend?.status || "detenido"}
                        {backend?.port ? ` · :${backend.port}` : ""}
                      </span>

                      <span
                        className={`rounded-full px-2 py-1 ${
                          frontend?.status === "running"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-slate-500/15 text-slate-400"
                        }`}
                      >
                        Frontend: {frontend?.status || "detenido"}
                        {frontend?.port ? ` · :${frontend.port}` : ""}
                      </span>

                      {backend?.status === "running" && backend?.url && (
                        <a
                          className="break-all text-sky-300 underline"
                          href={backend.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {backend.url}
                        </a>
                      )}

                      {frontend?.status === "running" && frontend?.url && (
                        <a
                          className="break-all text-sky-300 underline"
                          href={frontend.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {frontend.url}
                        </a>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startEditing(project)}
                  className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 px-3 py-2 text-sm text-cyan-300 transition hover:bg-cyan-500/10"
                >
                  <Pencil className="h-4 w-4" />
                  Editar
                </button>

                <button
                  type="button"
                  onClick={() => toggleProject(project)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    project.active
                      ? "border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                      : "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                  }`}
                >
                  <Power className="h-4 w-4" />

                  {project.active ? "Desactivar" : "Activar"}
                </button>

                {project.backend_path && project.frontend_path && (
                  <>
                    <button
                      type="button"
                      onClick={() => runProcessAction(project.id, "start")}
                      disabled={processActionId === `${project.id}:start`}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Play className="h-4 w-4" />
                      Iniciar
                    </button>

                    <button
                      type="button"
                      onClick={() => runProcessAction(project.id, "stop")}
                      disabled={processActionId === `${project.id}:stop`}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Square className="h-4 w-4" />
                      Detener
                    </button>

                    <button
                      type="button"
                      onClick={() => runProcessAction(project.id, "restart")}
                      disabled={processActionId === `${project.id}:restart`}
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 px-3 py-2 text-sm text-amber-300 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Reiniciar
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default ProjectManager;
