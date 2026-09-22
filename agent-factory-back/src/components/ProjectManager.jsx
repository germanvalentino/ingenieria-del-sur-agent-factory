import { useEffect, useState } from "react";
import {
  FolderGit2,
  Pencil,
  Plus,
  Power,
  Save,
  X,
} from "lucide-react";

const PROJECTS_API = "http://localhost:3001/api/projects";

const EMPTY_FORM = {
  name: "",
  description: "",
  frontendPath: "",
  backendPath: "",
  repositoryUrl: "",
  defaultBranch: "main",
};

function ProjectManager({ onProjectsChanged }) {
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadProjects() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(PROJECTS_API, {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "No se pudieron cargar los proyectos");
      }

      setProjects(data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      loadProjects();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function startEditing(project) {
    setEditingId(project.id);

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

  async function saveProject(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setError("");

      const isEditing = Boolean(editingId);
      const url = isEditing
        ? `${PROJECTS_API}/${editingId}`
        : PROJECTS_API;

      const response = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "No se pudo guardar el proyecto");
      }

      cancelEditing();
      await loadProjects();
      await onProjectsChanged?.();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "No se pudo cambiar el estado del proyecto",
        );
      }

      await loadProjects();
      await onProjectsChanged?.();
    } catch (statusError) {
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

        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
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
        </div>
      </form>

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
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default ProjectManager;