import { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  CirclePlus,
  Clock3,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  Play,
  RefreshCw,
} from "lucide-react";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://localhost:3001/api";

const initialForm = {
  projectId: "",
  title: "",
  description: "",
  assignedRole: "backend",
};

const statusClasses = {
  backlog: "bg-slate-500/15 text-slate-300",
  queued: "bg-amber-500/15 text-amber-300",
  running: "bg-sky-500/15 text-sky-300",
  review: "bg-violet-500/15 text-violet-300",
  passed: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
};

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
  const [dashboard, setDashboard] = useState({
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
  });

  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningTaskId, setRunningTaskId] =
    useState(null);
  const [error, setError] = useState("");

  async function loadDashboard() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        `${API_URL}/dashboard`
      );

      if (!response.ok) {
        throw new Error(
          "No se pudo cargar el dashboard"
        );
      }

      const data = await response.json();

      setDashboard(data);

      setForm((current) => ({
        ...current,
        projectId:
          current.projectId ||
          data.projects[0]?.id ||
          "",
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.projectId || !form.title.trim()) {
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
          body: JSON.stringify(form),
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
        projectId: current.projectId,
      }));

      await loadDashboard();
    } catch (err) {
      setError(err.message);
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
      setError(err.message);
      await loadDashboard();
    } finally {
      setRunningTaskId(null);
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

    await loadDashboard();
  } catch (err) {
    setError(err.message);
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
                      value={form.projectId}
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
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-3">
                          <span className="text-xs text-slate-500">
                            {task.project_name}
                          </span>

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

                          {task.status === "review" && (
                              <button
                                type="button"
                                onClick={() => approveTask(task.id)}
                                className="flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                              >
                                <CheckCircle2 size={14} />
                                Aprobar
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
      </main>

      <footer className="mt-10 border-t border-white/10 py-6 text-center text-sm text-slate-500">
        Ingeniería del Sur · MVP 0.1 · Agent Software
        Factory
      </footer>
    </div>
  );
}

export default App;
