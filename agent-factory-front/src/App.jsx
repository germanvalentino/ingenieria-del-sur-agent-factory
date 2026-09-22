import { useState, useSyncExternalStore } from "react";
import {
  Bot,
  CheckCircle2,
  CirclePlus,
  Clock3,
  History,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  MessageSquareWarning,
  Wrench,
} from "lucide-react";
import ProjectManager from "./components/ProjectManager";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://localhost:3001/api";

const initialForm = {
  projectId: "",
  title: "",
  description: "",
  assignedRole: "backend",
};

const initialDashboard = {
  projects: [],
  agents: [],
  tasks: [],
  metrics: {
    totalTasks: 0,
    queuedTasks: 0,
    runningTasks: 0,
    passedTasks: 0,
    failedTasks: 0,
  },
};

const initialDashboardState = {
  dashboard: initialDashboard,
  loading: true,
  error: "",
  lastUpdateTime: "",
};

const statusClasses = {
  backlog: "bg-slate-500/15 text-slate-300",
  queued: "bg-amber-500/15 text-amber-300",
  running: "bg-sky-500/15 text-sky-300",
  review: "bg-violet-500/15 text-violet-300",
  passed: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
};

const numberFormatter = new Intl.NumberFormat("es-AR");

const executionStatusClasses = {
  completed: "bg-emerald-500/15 text-emerald-300",
  passed: "bg-emerald-500/15 text-emerald-300",
  success: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
  error: "bg-red-500/15 text-red-300",
  running: "bg-sky-500/15 text-sky-300",
  queued: "bg-amber-500/15 text-amber-300",
};

function pickValue(record, keys) {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }

  return null;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "Sin datos";
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return String(value);
  }

  return numberFormatter.format(numberValue);
}

function formatDateTime(value) {
  if (!value) {
    return "Sin datos";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatDuration(milliseconds) {
  if (
    milliseconds === null ||
    milliseconds === undefined ||
    milliseconds === ""
  ) {
    return "Sin datos";
  }

  const duration = Number(milliseconds);

  if (!Number.isFinite(duration)) {
    return String(milliseconds);
  }

  if (duration < 1000) {
    return `${numberFormatter.format(duration)} ms`;
  }

  const totalSeconds = Math.round(duration / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours} h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes} min`);
  }

  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} s`);
  }

  return parts.join(" ");
}

function getInputTokens(execution) {
  return pickValue(execution, [
    "input_tokens",
    "inputTokens",
    "prompt_tokens",
    "promptTokens",
  ]);
}

function getOutputTokens(execution) {
  return pickValue(execution, [
    "output_tokens",
    "outputTokens",
    "completion_tokens",
    "completionTokens",
  ]);
}

function getTotalTokens(execution) {
  return pickValue(execution, [
    "total_tokens",
    "totalTokens",
    "tokens_total",
    "tokensTotal",
  ]);
}

function getDisplayTotalTokens(execution) {
  return getTotalTokens(execution);
}

function getDurationMs(execution) {
  const milliseconds = pickValue(execution, [
    "duration_ms",
    "durationMs",
    "elapsed_ms",
    "elapsedMs",
  ]);

  if (milliseconds !== null) {
    return milliseconds;
  }

  const seconds = pickValue(execution, [
    "duration_seconds",
    "durationSeconds",
    "elapsed_seconds",
    "elapsedSeconds",
  ]);

  if (seconds !== null && Number.isFinite(Number(seconds))) {
    return Number(seconds) * 1000;
  }

  return pickValue(execution, ["duration", "elapsed"]);
}

function sumKnownValues(values) {
  const numbers = values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter(Number.isFinite);

  if (numbers.length === 0) {
    return null;
  }

  return numbers.reduce((total, value) => total + value, 0);
}

function normalizeTaskHistory(data) {
  const executions = Array.isArray(data)
    ? data
    : data?.executions || data?.items || data?.history || [];
  const summary = data?.summary || data?.totals || {};

  return {
    executions,
    summary: {
      count:
        pickValue(summary, [
          "execution_count",
          "executionCount",
          "executions_count",
          "executionsCount",
          "count",
          "total",
        ]) ?? executions.length,
      inputTokens:
        pickValue(summary, ["input_tokens", "inputTokens"]) ??
        sumKnownValues(executions.map(getInputTokens)),
      outputTokens:
        pickValue(summary, ["output_tokens", "outputTokens"]) ??
        sumKnownValues(executions.map(getOutputTokens)),
      totalTokens:
        pickValue(summary, ["total_tokens", "totalTokens"]) ??
        sumKnownValues(executions.map(getDisplayTotalTokens)),
      durationMs:
        pickValue(summary, [
          "duration_ms",
          "durationMs",
          "total_duration_ms",
          "totalDurationMs",
        ]) ?? sumKnownValues(executions.map(getDurationMs)),
    },
  };
}

function pluralizeCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatUpdateTime(date) {
  return date.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getErrorMessage(error) {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado";
}

function createDashboardStore() {
  let dashboardState = initialDashboardState;
  const listeners = new Set();

  function emitChange() {
    listeners.forEach((listener) => listener());
  }

  function setDashboardState(update) {
    dashboardState =
      typeof update === "function"
        ? update(dashboardState)
        : update;
    emitChange();
  }

  async function loadDashboard() {
    try {
      setDashboardState((current) => ({
        ...current,
        loading: true,
        error: "",
      }));

    const response = await fetch(
      `${API_URL}/dashboard`,
      {
        cache: "no-store",
      }
    );

      if (!response.ok) {
        throw new Error(
          "No se pudo cargar el dashboard"
        );
      }

      const data = await response.json();

      setDashboardState((current) => ({
        ...current,
        dashboard: data,
        loading: false,
        lastUpdateTime: formatUpdateTime(new Date()),
      }));
    } catch (error) {
      setDashboardState((current) => ({
        ...current,
        error: getErrorMessage(error),
        loading: false,
      }));
    }
  }

  loadDashboard();

  return {
    getSnapshot() {
      return dashboardState;
    },
    setError(message) {
      setDashboardState((current) => ({
        ...current,
        error: message,
      }));
    },
    updateDashboard(update) {
      setDashboardState((current) => ({
        ...current,
        dashboard:
          typeof update === "function"
            ? update(current.dashboard)
            : update,
      }));
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    loadDashboard,
  };
}

const dashboardStore = createDashboardStore();

function MetricCard({
  title,
  value,
  icon: Icon,
  color,
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">
          {title}
        </span>

        <Icon className={color} size={20} />
      </div>

      <strong className="mt-3 block text-3xl text-white">
        {value}
      </strong>
    </article>
  );
}

function App() {
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [runningTaskId, setRunningTaskId] =
    useState(null);
  const [qaTaskId, setQaTaskId] = useState(null);
  const [
  correctionTaskId,
  setCorrectionTaskId,
] = useState(null);
  const [openHistoryTaskId, setOpenHistoryTaskId] =
    useState(null);
  const [taskHistories, setTaskHistories] = useState({});
  const {
    dashboard,
    loading,
    error,
    lastUpdateTime,
  } = useSyncExternalStore(
    dashboardStore.subscribe,
    dashboardStore.getSnapshot
  );
  const selectedProjectId =
    form.projectId || dashboard.projects[0]?.id || "";
  const loadDashboard = dashboardStore.loadDashboard;
  const setDashboard = dashboardStore.updateDashboard;
  const setError = (message) => {
    dashboardStore.setError(message);
  };

  async function toggleTaskHistory(taskId) {
    const shouldOpen = openHistoryTaskId !== taskId;

    setOpenHistoryTaskId(shouldOpen ? taskId : null);

    if (!shouldOpen || taskHistories[taskId]?.data) {
      return;
    }

    try {
      setTaskHistories((current) => ({
        ...current,
        [taskId]: {
          loading: true,
          error: "",
          data: null,
        },
      }));

      const response = await fetch(
        `${API_URL}/tasks/${taskId}/executions`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "No se pudo cargar el historial"
        );
      }

      setTaskHistories((current) => ({
        ...current,
        [taskId]: {
          loading: false,
          error: "",
          data: normalizeTaskHistory(data),
        },
      }));
    } catch (err) {
      setTaskHistories((current) => ({
        ...current,
        [taskId]: {
          loading: false,
          error: getErrorMessage(err),
          data: null,
        },
      }));
    }
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!selectedProjectId || !form.title.trim()) {
      setError(
        "Seleccioná un proyecto e ingresá un título"
      );
      return;
    }

    try {
      setSaving(true);
      setError("");

      const response = await fetch(
        `${API_URL}/tasks`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...form,
            projectId: selectedProjectId,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "No se pudo crear la tarea"
        );
      }

      setForm((current) => ({
        ...initialForm,
        projectId:
          current.projectId || selectedProjectId,
      }));

      await loadDashboard();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function runTask(taskId) {
    try {
      setRunningTaskId(taskId);
      setError("");

      setDashboard((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: "running",
              }
            : task
        ),
      }));

      const response = await fetch(
        `${API_URL}/tasks/${taskId}/run`,
        {
          method: "POST",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "No se pudo ejecutar la tarea"
        );
      }

      await loadDashboard();
    } catch (err) {
      setError(getErrorMessage(err));
      await loadDashboard();
    } finally {
      setRunningTaskId(null);
    }
  }

  async function retryTask(taskId) {
    try {
      setError("");

      const response = await fetch(
        `${API_URL}/tasks/${taskId}/retry`,
        {
          method: "POST",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "No se pudo reintentar la tarea"
        );
      }

      await loadDashboard();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

async function runQa(taskId) {
  try {
    setQaTaskId(taskId);
    setError("");

    setDashboard((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              qa_status: "running",
            }
          : task
      ),
    }));

    const response = await fetch(
      `${API_URL}/tasks/${taskId}/qa`,
      {
        method: "POST",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
          "No se pudo ejecutar QA"
      );
    }

    await loadDashboard();
  } catch (err) {
    setError(getErrorMessage(err));
    await loadDashboard();
  } finally {
    setQaTaskId(null);
  }
}

async function rejectTask(taskId) {
  const notes = window.prompt(
    "Escribí las observaciones que deberá corregir el agente:"
  );

  if (!notes?.trim()) {
    return;
  }

  try {
    setError("");

    const response = await fetch(
      `${API_URL}/tasks/${taskId}/reject`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          notes: notes.trim(),
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
          "No se pudo rechazar la tarea"
      );
    }

    await loadDashboard();
  } catch (err) {
    setError(err.message);
  }
}

async function correctTask(taskId) {
  try {
    setCorrectionTaskId(taskId);
    setError("");

    setDashboard((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "running",
            }
          : task
      ),
    }));

    const response = await fetch(
      `${API_URL}/tasks/${taskId}/correct`,
      {
        method: "POST",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
          "No se pudo corregir la tarea"
      );
    }

    await loadDashboard();
  } catch (err) {
    setError(err.message);
    await loadDashboard();
  } finally {
    setCorrectionTaskId(null);
  }
}
  async function approveTask(taskId) {
  try {
    setError("");

    const response = await fetch(
      `${API_URL}/tasks/${taskId}/approve`,
      {
        method: "POST",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "No se pudo aprobar la tarea"
      );
    }

    setDashboard((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              ...data,
              status: "passed",
            }
          : task
      ),
    }));
    await loadDashboard();
  } catch (err) {
    setError(getErrorMessage(err));
  }
}

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-white/10 bg-slate-950/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.28em] text-sky-400">
              INGENIERÍA DEL SUR
            </p>

            <h1 className="mt-1 text-xl font-semibold text-white">
              Agent Software Factory
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {lastUpdateTime && (
              <span className="text-xs text-slate-500">
                Última actualización: {lastUpdateTime}
              </span>
            )}

            <button
              type="button"
              onClick={loadDashboard}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-sky-400/50 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                size={16}
                className={
                  loading ? "animate-spin" : ""
                }
              />
              Actualizar
            </button>

            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
              Sistema operativo
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-sky-400">
            <LayoutDashboard size={18} />

            <span className="text-sm font-medium">
              Centro de operaciones
            </span>
          </div>

          <p className="mt-1 text-sm text-slate-500">
            {pluralizeCount(
              dashboard.agents.length,
              "agente",
              "agentes"
            )}{" "}
            y{" "}
            {pluralizeCount(
              dashboard.projects.length,
              "proyecto",
              "proyectos"
            )}{" "}
            configurados
          </p>

          <h2 className="mt-2 text-3xl font-bold text-white">
            Construimos software con agentes
          </h2>

          <p className="mt-2 text-slate-400">
            Creá una tarea y asignala al agente
            correspondiente.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-slate-400">
            Cargando dashboard...
          </p>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-4">
              <MetricCard
                title="Tareas totales"
                value={
                  dashboard.metrics.totalTasks
                }
                icon={ListTodo}
                color="text-sky-400"
              />

              <MetricCard
                title="En cola"
                value={
                  dashboard.metrics.queuedTasks
                }
                icon={Clock3}
                color="text-amber-400"
              />

              <MetricCard
                title="En ejecución"
                value={
                  dashboard.metrics.runningTasks
                }
                icon={Bot}
                color="text-violet-400"
              />

              <MetricCard
                title="Aprobadas"
                value={
                  dashboard.metrics.passedTasks
                }
                icon={CheckCircle2}
                color="text-emerald-400"
              />
            </section>

            <section className="mt-8 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
              <form
                onSubmit={handleSubmit}
                className="rounded-2xl border border-white/10 bg-white/5 p-6"
              >
                <div className="flex items-center gap-2">
                  <CirclePlus
                    size={20}
                    className="text-sky-400"
                  />

                  <h3 className="text-lg font-semibold text-white">
                    Nueva tarea
                  </h3>
                </div>

                <div className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">
                      Proyecto
                    </label>

                    <select
                      name="projectId"
                      value={selectedProjectId}
                      onChange={handleChange}
                      className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5"
                    >
                      {dashboard.projects.map(
                        (project) => (
                          <option
                            key={project.id}
                            value={project.id}
                          >
                            {project.name}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm text-slate-400">
                      Título
                    </label>

                    <input
                      name="title"
                      value={form.title}
                      onChange={handleChange}
                      placeholder="Ej: Crear pantalla de proyectos"
                      className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5 outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm text-slate-400">
                      Descripción
                    </label>

                    <textarea
                      name="description"
                      value={form.description}
                      onChange={handleChange}
                      rows="4"
                      placeholder="Detalle y criterios de aceptación"
                      className="w-full resize-none rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5 outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm text-slate-400">
                      Agente
                    </label>

                    <select
                      name="assignedRole"
                      value={form.assignedRole}
                      onChange={handleChange}
                      className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5"
                    >
                      <option value="frontend">
                        Frontend Agent
                      </option>

                      <option value="backend">
                        Backend Agent
                      </option>

                      <option value="qa">
                        QA Agent
                      </option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full rounded-lg bg-sky-500 py-2.5 font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
                  >
                    {saving
                      ? "Creando..."
                      : "Asignar tarea"}
                  </button>
                </div>
              </form>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h3 className="text-lg font-semibold text-white">
                  Cola de trabajo
                </h3>

                <div className="mt-5 space-y-3">
                  {dashboard.tasks.length === 0 && (
                    <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-slate-500">
                      Todavía no hay tareas.
                    </div>
                  )}

                  {dashboard.tasks.map((task) => (
                    <article
                      key={task.id}
                      className="rounded-xl border border-white/10 bg-slate-950/50 p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-1 text-xs ${
                                statusClasses[
                                  task.status
                                ] ||
                                statusClasses.backlog
                              }`}
                            >
                              {task.status}
                            </span>

                            <span className="text-xs uppercase text-slate-500">
                              {task.assigned_role}
                            </span>

                            {Number(task.correction_count) > 0 && (
                              <span className="text-xs text-amber-300">
                                {Number(
                                  task.correction_count,
                                ) === 1
                                  ? "1 corrección"
                                  : `${task.correction_count} correcciones`}
                              </span>
                            )}
                          </div>

                          <h4 className="mt-3 font-medium text-white">
                            {task.title}
                          </h4>

                          <p className="mt-1 text-sm text-slate-400">
                            {task.description}
                          </p>

                          <p className="mt-3 break-all text-xs text-slate-600">
                            {task.branch_name}
                          </p>

                          {task.result_summary && (
                            <details className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
                              <summary className="cursor-pointer text-xs font-medium text-sky-300">
                                Ver resultado del agente
                              </summary>

                              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-400">
                                {
                                  task.result_summary
                                }
                              </pre>
                            </details>
                          )}
                          {task.qa_summary && (
                            <details className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
                              <summary
                                className={`cursor-pointer text-xs font-medium ${
                                  task.qa_status === "passed"
                                    ? "text-emerald-300"
                                    : "text-red-300"
                                }`}
                              >
                                Ver resultado QA ·{" "}
                                {task.qa_status}
                              </summary>

                              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-400">
                                {task.qa_summary}
                              </pre>
                            </details>
                          )}

                          {task.review_feedback && (
                            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                                <MessageSquareWarning size={14} />
                                Observaciones humanas
                              </div>

                              <p className="mt-2 whitespace-pre-wrap text-sm text-amber-100">
                                {task.review_feedback}
                              </p>
                            </div>
                          )}

                          {openHistoryTaskId === task.id &&
                            (() => {
                              const historyState =
                                taskHistories[task.id];
                              const history =
                                historyState?.data;

                              return (
                                <div className="mt-4 rounded-lg border border-sky-500/20 bg-slate-950/80 p-4">
                                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                                    <History
                                      size={16}
                                      className="text-sky-300"
                                    />
                                    Historial de ejecuciones
                                  </div>

                                  {historyState?.loading && (
                                    <div className="flex items-center gap-2 text-sm text-slate-400">
                                      <LoaderCircle
                                        size={15}
                                        className="animate-spin"
                                      />
                                      Cargando historial...
                                    </div>
                                  )}

                                  {historyState?.error && (
                                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                                      {historyState.error}
                                    </div>
                                  )}

                                  {history &&
                                    !historyState.loading &&
                                    !historyState.error && (
                                      <>
                                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                                          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="text-[11px] uppercase text-slate-500">
                                              Ejecuciones
                                            </p>
                                            <strong className="mt-1 block text-sm text-white">
                                              {formatNumber(
                                                history.summary
                                                  .count,
                                              )}
                                            </strong>
                                          </div>

                                          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="text-[11px] uppercase text-slate-500">
                                              Tokens entrada
                                            </p>
                                            <strong className="mt-1 block text-sm text-white">
                                              {formatNumber(
                                                history.summary
                                                  .inputTokens,
                                              )}
                                            </strong>
                                          </div>

                                          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="text-[11px] uppercase text-slate-500">
                                              Tokens salida
                                            </p>
                                            <strong className="mt-1 block text-sm text-white">
                                              {formatNumber(
                                                history.summary
                                                  .outputTokens,
                                              )}
                                            </strong>
                                          </div>

                                          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="text-[11px] uppercase text-slate-500">
                                              Tokens totales
                                            </p>
                                            <strong className="mt-1 block text-sm text-white">
                                              {formatNumber(
                                                history.summary
                                                  .totalTokens,
                                              )}
                                            </strong>
                                          </div>

                                          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="text-[11px] uppercase text-slate-500">
                                              Duración total
                                            </p>
                                            <strong className="mt-1 block text-sm text-white">
                                              {formatDuration(
                                                history.summary
                                                  .durationMs,
                                              )}
                                            </strong>
                                          </div>
                                        </div>

                                        {history.executions
                                          .length === 0 ? (
                                          <div className="mt-4 rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">
                                            Sin ejecuciones
                                            registradas
                                          </div>
                                        ) : (
                                          <div className="mt-4 space-y-3">
                                            {history.executions.map(
                                              (
                                                execution,
                                                index,
                                              ) => {
                                                const executionStatus =
                                                  pickValue(
                                                    execution,
                                                    [
                                                      "status",
                                                      "state",
                                                    ],
                                                  ) ||
                                                  "Sin datos";
                                                const statusClass =
                                                  executionStatusClasses[
                                                    executionStatus
                                                  ] ||
                                                  "bg-slate-500/15 text-slate-300";
                                                const errorMessage =
                                                  pickValue(
                                                    execution,
                                                    [
                                                      "error_message",
                                                      "errorMessage",
                                                      "error",
                                                    ],
                                                  );

                                                return (
                                                  <div
                                                    key={
                                                      execution.id ||
                                                      index
                                                    }
                                                    className="rounded-lg border border-white/10 bg-black/20 p-3"
                                                  >
                                                    <div className="flex flex-wrap items-center gap-2">
                                                      <span
                                                        className={`rounded-full px-2 py-1 text-[11px] ${statusClass}`}
                                                      >
                                                        {
                                                          executionStatus
                                                        }
                                                      </span>

                                                      <span className="text-xs font-medium text-slate-300">
                                                        {pickValue(
                                                          execution,
                                                          [
                                                            "execution_type",
                                                            "executionType",
                                                            "type",
                                                          ],
                                                        ) ||
                                                          "Sin datos"}
                                                      </span>

                                                      <span className="text-xs text-slate-500">
                                                        {formatDateTime(
                                                          pickValue(
                                                            execution,
                                                            [
                                                              "created_at",
                                                              "createdAt",
                                                              "started_at",
                                                              "startedAt",
                                                              "executed_at",
                                                              "executedAt",
                                                            ],
                                                          ),
                                                        )}
                                                      </span>
                                                    </div>

                                                    <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2 xl:grid-cols-3">
                                                      <p>
                                                        Agente/proveedor:{" "}
                                                        <span className="text-slate-200">
                                                          {pickValue(
                                                            execution,
                                                            [
                                                              "agent_name",
                                                              "agentName",
                                                              "agent",
                                                              "provider_name",
                                                              "providerName",
                                                              "provider",
                                                            ],
                                                          ) ||
                                                            "Sin datos"}
                                                        </span>
                                                      </p>

                                                      <p>
                                                        Modelo:{" "}
                                                        <span className="text-slate-200">
                                                          {pickValue(
                                                            execution,
                                                            [
                                                              "model",
                                                              "model_name",
                                                              "modelName",
                                                            ],
                                                          ) ||
                                                            "Sin datos"}
                                                        </span>
                                                      </p>

                                                      <p>
                                                        Duración:{" "}
                                                        <span className="text-slate-200">
                                                          {formatDuration(
                                                            getDurationMs(
                                                              execution,
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>

                                                      <p>
                                                        Entrada:{" "}
                                                        <span className="text-slate-200">
                                                          {formatNumber(
                                                            getInputTokens(
                                                              execution,
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>

                                                      <p>
                                                        Salida:{" "}
                                                        <span className="text-slate-200">
                                                          {formatNumber(
                                                            getOutputTokens(
                                                              execution,
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>

                                                      <p>
                                                        Total:{" "}
                                                        <span className="text-slate-200">
                                                          {formatNumber(
                                                            getDisplayTotalTokens(
                                                              execution,
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>
                                                    </div>

                                                    {errorMessage && (
                                                      <p className="mt-3 whitespace-pre-wrap rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                                                        {errorMessage}
                                                      </p>
                                                    )}
                                                  </div>
                                                );
                                              },
                                            )}
                                          </div>
                                        )}
                                      </>
                                    )}
                                </div>
                              );
                            })()}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-3">
                          <span className="text-xs text-slate-500">
                            {task.project_name}
                          </span>

                          <button
                            type="button"
                            onClick={() =>
                              toggleTaskHistory(task.id)
                            }
                            className="flex items-center gap-2 rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10"
                          >
                            <History size={14} />
                            {openHistoryTaskId === task.id
                              ? "Ocultar historial"
                              : "Historial"}
                          </button>

                          {task.status ===
                            "queued" && (
                            <button
                              type="button"
                              onClick={() =>
                                runTask(task.id)
                              }
                              disabled={
                                runningTaskId !== null
                              }
                              className="flex items-center gap-2 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
                            >
                              <Play size={14} />
                              Ejecutar
                            </button>
                          )}

                          {task.status ===
                            "failed" && (
                            <button
                              type="button"
                              onClick={() =>
                                retryTask(task.id)
                              }
                              className="flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                            >
                              <LoaderCircle size={14} />
                              Reintentar
                            </button>
                          )}

{task.status === "review" &&
  !task.review_feedback &&
  task.qa_status !== "running" &&
  task.qa_status !== "passed" && (
    <button
      type="button"
      onClick={() => runQa(task.id)}
      disabled={qaTaskId !== null}
      className="flex items-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
    >
      <ShieldCheck size={14} />

      {task.qa_status === "failed"
        ? "Reintentar QA"
        : "Ejecutar QA"}
    </button>
  )}

{task.status === "review" &&
  task.qa_status === "running" && (
    <span className="flex items-center gap-2 text-xs text-violet-300">
      <LoaderCircle
        size={15}
        className="animate-spin"
      />
      QA ejecutando
    </span>
  )}

{task.status === "review" &&
  !task.review_feedback &&
  task.qa_status === "passed" && (
    <button
      type="button"
      onClick={() =>
        approveTask(task.id)
      }
      className="flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
    >
      <CheckCircle2 size={14} />
      Aprobar
    </button>
  )}

{task.status === "review" &&
  !task.review_feedback && (
    <button
      type="button"
      onClick={() =>
        rejectTask(task.id)
      }
      className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20"
    >
      <MessageSquareWarning size={14} />
      Rechazar
    </button>
  )}

{task.status === "review" &&
  task.review_feedback && (
    <button
      type="button"
      onClick={() =>
        correctTask(task.id)
      }
      disabled={
        correctionTaskId !== null
      }
      className="flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
    >
      <Wrench size={14} />
      Corregir con agente
    </button>
  )}

                          {task.status ===
                            "running" && (
                            <span className="flex items-center gap-2 text-xs text-sky-300">
                              <LoaderCircle
                                size={15}
                                className="animate-spin"
                              />

                              Codex trabajando
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-lg font-semibold text-white">
                Equipo digital
              </h3>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {dashboard.agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="rounded-xl border border-white/10 bg-slate-950/50 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-white">
                        {agent.name}
                      </p>

                      <i
                        className={`h-2 w-2 rounded-full ${
                          agent.status ===
                          "working"
                            ? "bg-sky-400"
                            : agent.status ===
                                "offline"
                              ? "bg-red-400"
                              : "bg-emerald-400"
                        }`}
                      />
                    </div>

                    <p className="mt-2 text-xs uppercase text-slate-500">
                      {agent.role} ·{" "}
                      {agent.provider}
                    </p>

                    <p className="mt-2 text-xs text-slate-400">
                      Estado: {agent.status}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
        <ProjectManager onProjectsChanged={loadDashboard} />
      </main>

      <footer className="mt-10 border-t border-white/10 py-6 text-center text-sm text-slate-500">
        Ingeniería del Sur · MVP 0.1 · Agent Software
        Factory
        <p className="mt-2 text-xs text-slate-600">
          Ingeniería de software impulsada por agentes
        </p>
      </footer>
    </div>
  );
}

export default App;
