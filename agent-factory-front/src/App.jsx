import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Bot,
  CheckCircle2,
  CirclePlus,
  Clock3,
  FolderGit2,
  History,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  MessageSquareWarning,
  Wrench,
  WandSparkles,
} from "lucide-react";
import ProjectManager from "./components/ProjectManager";
import SpecificationAssistant from "./components/SpecificationAssistant";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://localhost:3001/api";

const initialForm = {
  projectId: "",
  title: "",
  description: "",
  assignedRole: "backend",
  provider: "codex",
};

const initialDashboard = {
  serverTime: null,
  projects: [],
  agents: [],
  tasks: [],
  providerConfig: {},
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
  initialized: false,
};

const fallbackAgentOptions = [
  { value: "frontend", label: "Frontend Agent" },
  { value: "backend", label: "Backend Agent" },
  { value: "qa", label: "QA Agent" },
  { value: "fullstack", label: "Fullstack Agent" },
];

const agentRoleLabels = {
  frontend: "Frontend Agent",
  backend: "Backend Agent",
  qa: "QA Agent",
  fullstack: "Fullstack Agent",
};

const tabs = [
  {
    id: "operations",
    label: "Operaciones",
    icon: LayoutDashboard,
  },
  {
    id: "specifications",
    label: "Especificacion IA",
    icon: WandSparkles,
  },
  {
    id: "projects",
    label: "Proyectos",
    icon: FolderGit2,
  },
];

const statusClasses = {
  backlog: "bg-slate-500/15 text-slate-300",
  queued: "bg-amber-500/15 text-amber-300",
  running: "bg-sky-500/15 text-sky-300",
  review: "bg-violet-500/15 text-violet-300",
  passed: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
};

const numberFormatter = new Intl.NumberFormat("es-AR");
const costFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});

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

function getAgentRole(agent) {
  const role = pickValue(agent, [
    "assignedRole",
    "assigned_role",
    "role",
  ]);

  return role ? String(role).toLowerCase() : null;
}

function isActiveAgent(agent) {
  if (agent?.active !== undefined) {
    return agent.active === true || agent.active === "true";
  }

  const status = String(agent?.status || "").toLowerCase();

  return ![
    "offline",
    "inactive",
    "disabled",
  ].includes(status);
}

function getAgentOptions(agents) {
  const activeAgentOptions = (agents || [])
    .filter(isActiveAgent)
    .map((agent) => {
      const role = getAgentRole(agent);

      if (!role) {
        return null;
      }

      return {
        value: role,
        label: agentRoleLabels[role] || agent.name || role,
      };
    })
    .filter(Boolean);

  if (activeAgentOptions.length === 0) {
    return fallbackAgentOptions;
  }

  return Array.from(
    new Map(
      activeAgentOptions.map((option) => [
        option.value,
        option,
      ])
    ).values()
  );
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

function getProviderLabel(provider) {
  const normalized = String(provider || "").toLowerCase();

  if (normalized === "claude") {
    return "Claude";
  }

  if (normalized === "codex") {
    return "Codex";
  }

  return provider || "Sin datos";
}

function getConfiguredModelLabel(
  provider,
  providerConfig,
) {
  const normalized = String(provider || "").toLowerCase();

  if (normalized !== "claude") {
    return null;
  }

  return (
    providerConfig?.claude?.model ||
    providerConfig?.claudeModel ||
    null
  );
}

function isProviderAllowedForRole(role, provider) {
  return !(
    String(role || "").toLowerCase() === "qa" &&
    String(provider || "").toLowerCase() === "claude"
  );
}

function formatCost(value) {
  if (value === null || value === undefined || value === "") {
    return "Sin datos";
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return "Sin datos";
  }

  return costFormatter.format(numberValue);
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

function getCachedInputTokens(execution) {
  return pickValue(execution, [
    "cached_input_tokens",
    "cachedInputTokens",
  ]);
}

function getNonCachedInputTokens(execution) {
  const inputTokens = getInputTokens(execution);
  const cachedInputTokens = getCachedInputTokens(execution);

  if (
    inputTokens === null ||
    inputTokens === undefined ||
    inputTokens === "" ||
    cachedInputTokens === null ||
    cachedInputTokens === undefined ||
    cachedInputTokens === ""
  ) {
    return null;
  }

  const inputTokenCount = Number(inputTokens);
  const cachedInputTokenCount = Number(cachedInputTokens);

  if (
    !Number.isFinite(inputTokenCount) ||
    !Number.isFinite(cachedInputTokenCount)
  ) {
    return null;
  }

  return Math.max(inputTokenCount - cachedInputTokenCount, 0);
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

function getCostUsd(execution) {
  return pickValue(execution, [
    "cost_usd",
    "costUsd",
    "total_cost_usd",
    "totalCostUsd",
  ]);
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
      cachedInputTokens: pickValue(summary, [
        "totalCachedInputTokens",
      ]),
      nonCachedInputTokens: pickValue(summary, [
        "totalNonCachedInputTokens",
      ]),
      outputTokens:
        pickValue(summary, ["output_tokens", "outputTokens"]) ??
        sumKnownValues(executions.map(getOutputTokens)),
      totalTokens:
        pickValue(summary, ["total_tokens", "totalTokens"]) ??
        sumKnownValues(executions.map(getDisplayTotalTokens)),
      costUsd:
        pickValue(summary, [
          "total_cost_usd",
          "totalCostUsd",
          "cost_usd",
          "costUsd",
        ]) ?? sumKnownValues(executions.map(getCostUsd)),
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

function formatServerTime(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return formatUpdateTime(date);
}

function getErrorMessage(error) {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado";
}

function getCorrectionAttempts(task) {
  return Number(
    task.correction_attempts ??
      task.correction_count ??
      0
  );
}

function getFinishedAutomaticCorrections(task) {
  return Number(
    task.auto_correction_finished_count ??
      task.correction_attempts ??
      0
  );
}

function getAutomaticCycleLabel(task) {
  const nextAttempt = Math.min(
    getCorrectionAttempts(task) + 1,
    3
  );

  if (task.auto_correction_stage === "correction") {
    return `Corrigiendo automaticamente (intento ${nextAttempt} de 3)`;
  }

  return `Ejecutando QA (intento ${nextAttempt} de 3)`;
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
        initialized: true,
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
  const [activeTab, setActiveTab] =
    useState("operations");
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [runningTaskId, setRunningTaskId] =
    useState(null);
  const [qaTaskId, setQaTaskId] = useState(null);
  const [pushingTaskId, setPushingTaskId] = useState(null);
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
    initialized,
  } = useSyncExternalStore(
    dashboardStore.subscribe,
    dashboardStore.getSnapshot
  );
  const queueListRef = useRef(null);
  const taskCardRefs = useRef(new Map());
  const pendingQueuePositionRef = useRef(null);
  const selectedProjectId =
    form.projectId || dashboard.projects[0]?.id || "";
  const agentOptions = getAgentOptions(dashboard.agents);
  const serverTime = formatServerTime(dashboard.serverTime);
  const loadDashboard = dashboardStore.loadDashboard;
  const setDashboard = dashboardStore.updateDashboard;
  const setError = (message) => {
    dashboardStore.setError(message);
  };
  const hasActiveAutomaticCycle =
    dashboard.tasks.some(
      (task) => task.auto_correction_active
    );
  const showInitialLoading = loading && !initialized;

  function rememberQueuePosition(taskId = null) {
    pendingQueuePositionRef.current = {
      taskId,
      scrollTop: queueListRef.current?.scrollTop ?? 0,
    };
  }

  function refreshDashboard() {
    rememberQueuePosition();
    return loadDashboard();
  }

  function setTaskCardRef(taskId, node) {
    if (node) {
      taskCardRefs.current.set(taskId, node);
      return;
    }

    taskCardRefs.current.delete(taskId);
  }

  useLayoutEffect(() => {
    const pendingPosition = pendingQueuePositionRef.current;
    const queueList = queueListRef.current;

    if (!pendingPosition || !queueList) {
      return;
    }

    pendingQueuePositionRef.current = null;
    queueList.scrollTop = pendingPosition.scrollTop;

    if (!pendingPosition.taskId) {
      return;
    }

    const taskCard = taskCardRefs.current.get(
      pendingPosition.taskId,
    );

    if (!taskCard) {
      return;
    }

    const visibleTop = queueList.scrollTop;
    const visibleBottom = visibleTop + queueList.clientHeight;
    const cardTop = taskCard.offsetTop;
    const cardBottom = cardTop + taskCard.offsetHeight;

    if (cardTop < visibleTop) {
      queueList.scrollTop = cardTop;
    } else if (cardBottom > visibleBottom) {
      queueList.scrollTop =
        cardBottom - queueList.clientHeight;
    }
  }, [dashboard.tasks]);

  useEffect(() => {
    if (!hasActiveAutomaticCycle) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      rememberQueuePosition();
      loadDashboard();
    }, 2500);

    return () => window.clearInterval(intervalId);
  }, [hasActiveAutomaticCycle, loadDashboard]);

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

    setForm((current) => {
      const next = {
        ...current,
        [name]: value,
      };

      if (
        !isProviderAllowedForRole(
          next.assignedRole,
          next.provider,
        )
      ) {
        next.provider = "codex";
      }

      return next;
    });
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
      rememberQueuePosition(taskId);
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
      rememberQueuePosition(taskId);
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
    rememberQueuePosition(taskId);
    setQaTaskId(taskId);
    setError("");

    setDashboard((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              qa_status: "running",
              auto_correction_active: true,
              auto_correction_stage: "qa",
              auto_correction_finished_count: 0,
              correction_attempts: 0,
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
    rememberQueuePosition(taskId);
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
    rememberQueuePosition(taskId);
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
  async function pushApprovedTask(task) {
    if (!task?.id || !task?.commit_hash) return;

    const confirmed = window.confirm(
      `¿Seguro que desea hacer el PUSH?\n\n` +
        `Remote: origin\n` +
        `Branch: ${task.base_branch || "main"}\n` +
        `Commit: ${task.commit_hash}`
    );

    if (!confirmed) return;

    try {
      setPushingTaskId(task.id);
      setError("");

      const response = await fetch(
        `${API_URL}/tasks/${task.id}/push`,
        { method: "POST" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "No se pudo realizar el PUSH");
      }

      if (data.task) {
        setDashboard((current) => ({
          ...current,
          tasks: current.tasks.map((currentTask) =>
            currentTask.id === task.id
              ? { ...currentTask, ...data.task }
              : currentTask
          ),
        }));
      }

      window.alert(
        `PUSH realizado correctamente.\n\n` +
          `Remote: ${data.push?.remote || "origin"}\n` +
          `Branch: ${data.push?.branch || task.base_branch || "main"}\n` +
          `Commit: ${data.push?.commitHash || task.commit_hash}`
      );

      await loadDashboard();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPushingTaskId(null);
    }
  }

  async function approveTask(taskId) {
    try {
      rememberQueuePosition(taskId);
      setError("");

      const response = await fetch(
        `${API_URL}/tasks/${taskId}/approve`,
        { method: "POST" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "No se pudo aprobar la tarea");
      }

      setDashboard((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? { ...task, ...data, status: "passed" }
            : task
        ),
      }));

      await pushApprovedTask({
        ...data,
        id: taskId,
        status: "passed",
      });

      await loadDashboard();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <div className="min-h-screen min-w-0 bg-slate-950 text-slate-200">
      <header className="border-b border-white/10 bg-slate-950/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.28em] text-sky-400">
              INGENIERÍA DEL SUR
            </p>

            <h1 className="mt-1 break-words text-xl font-semibold text-white">
              Agent Software Factory
            </h1>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-3 md:justify-end">
            {(lastUpdateTime || serverTime) && (
              <div className="min-w-0 flex-1 basis-full text-left text-xs text-slate-500 sm:basis-auto md:flex-none md:text-right">
                {lastUpdateTime && (
                  <p className="break-words">
                    Última actualización: {lastUpdateTime}
                  </p>
                )}

                {serverTime && (
                  <p className="break-words">Hora del servidor: {serverTime}</p>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={refreshDashboard}
              disabled={loading}
              className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-sky-400/50 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                size={16}
                className={
                  loading ? "animate-spin" : ""
                }
              />
              Actualizar datos
            </button>

            <span className="min-w-0 rounded-full bg-sky-500/15 px-3 py-1 text-xs text-white">
              Sistema Operativo version <span>1.0</span>
            </span>
          </div>
        </div>
      </header>

      <nav className="border-b border-white/10 bg-slate-950/70">
        <div className="mx-auto flex max-w-7xl gap-2 px-4 py-3 sm:px-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition sm:flex-none ${
                  isActive
                    ? "bg-sky-500 text-slate-950 shadow-lg shadow-sky-950/30"
                    : "border border-white/10 bg-white/5 text-slate-300 hover:border-sky-400/50 hover:bg-sky-500/10 hover:text-white"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="mx-auto min-w-0 max-w-7xl px-4 py-8 sm:px-6">
        {activeTab === "operations" ? (
          <>
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

        {showInitialLoading ? (
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

            <section className="mt-8 grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <form
                onSubmit={handleSubmit}
                className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6 lg:sticky lg:top-6"
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
                      disabled={saving}
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
                      disabled={saving}
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
                      disabled={saving}
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
                      disabled={saving}
                      className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5"
                    >
                      {agentOptions.map((agentOption) => (
                        <option
                          key={agentOption.value}
                          value={agentOption.value}
                        >
                          {agentOption.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm text-slate-400">
                      Proveedor
                    </label>

                    <select
                      name="provider"
                      value={form.provider}
                      onChange={handleChange}
                      disabled={saving}
                      className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2.5"
                    >
                      <option value="codex">
                        Codex
                      </option>
                      <option
                        value="claude"
                        disabled={
                          !isProviderAllowedForRole(
                            form.assignedRole,
                            "claude",
                          )
                        }
                      >
                        Claude
                      </option>
                    </select>

                    {!isProviderAllowedForRole(
                      form.assignedRole,
                      "claude",
                    ) && (
                      <p className="mt-2 text-xs text-slate-500">
                        QA conserva su proveedor actual.
                      </p>
                    )}

                    <p className="mt-2 text-xs text-slate-500">
                      {form.provider === "claude"
                        ? "Claude utiliza facturación API de Anthropic."
                        : "Codex utiliza la sesión configurada de ChatGPT."}
                    </p>

                    {form.provider === "claude" && (
                      <p className="mt-2 text-xs text-slate-500">
                        Modelo:{" "}
                        <span className="text-slate-300">
                          {getConfiguredModelLabel(
                            form.provider,
                            dashboard.providerConfig,
                          ) || "Sin datos"}
                        </span>
                      </p>
                    )}
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

              <div className="flex max-h-[calc(100vh-220px)] min-h-[320px] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                <div className="shrink-0 border-b border-white/10 bg-slate-950/80 px-4 py-5 sm:px-6">
                  <h3 className="text-lg font-semibold text-white">
                    Cola de trabajo
                  </h3>
                </div>

                <div
                  ref={queueListRef}
                  className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5"
                >
                  {dashboard.tasks.length === 0 && (
                    <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-slate-500">
                      Todavía no hay tareas.
                    </div>
                  )}

                  {dashboard.tasks.map((task) => (
                    <article
                      key={task.id}
                      ref={(node) =>
                        setTaskCardRef(task.id, node)
                      }
                      className="min-w-0 rounded-xl border border-white/10 bg-slate-950/50 p-3 sm:p-4"
                    >
                      <div className="flex min-w-0 flex-col items-stretch gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
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

                            <span className="min-w-0 break-words text-xs uppercase text-slate-500">
                              {task.assigned_role}
                            </span>

                            <span className="min-w-0 break-words text-xs text-sky-300">
                              {getProviderLabel(
                                task.provider,
                              )}
                            </span>

                            {task.model && (
                              <span className="min-w-0 break-words text-xs text-slate-500">
                                {task.model}
                              </span>
                            )}

                            {getCorrectionAttempts(task) > 0 && (
                              <span className="min-w-0 break-words text-xs text-amber-300">
                                {Number(
                                  getCorrectionAttempts(task),
                                ) === 1
                                  ? "1 corrección"
                                  : `${getCorrectionAttempts(task)} correcciones`}
                              </span>
                            )}

                            {getFinishedAutomaticCorrections(task) > 0 && (
                              <span className="min-w-0 break-words text-xs text-cyan-300">
                                Automaticas:{" "}
                                {getFinishedAutomaticCorrections(task)}
                              </span>
                            )}
                          </div>

                          <h4 className="mt-3 break-words font-medium text-white">
                            {task.title}
                          </h4>

                          <p className="mt-1 break-words text-sm text-slate-400">
                            {task.description}
                          </p>

                          <p className="mt-3 break-all text-xs text-slate-600">
                            {task.branch_name}
                          </p>

                          {task.auto_correction_active && (
                            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200">
                              <LoaderCircle
                                size={14}
                                className="animate-spin"
                              />
                              {getAutomaticCycleLabel(task)}
                            </div>
                          )}

                          {!task.auto_correction_active &&
                            task.qa_summary &&
                            ["passed", "failed"].includes(
                              task.qa_status,
                            ) && (
                              <p className="mt-3 break-words text-xs text-cyan-300">
                                Correcciones automaticas realizadas:{" "}
                                {getFinishedAutomaticCorrections(task)}
                              </p>
                            )}

                          {task.result_summary && (
                            <details className="mt-4 min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
                              <summary className="cursor-pointer text-xs font-medium text-sky-300">
                                Ver resultado del agente
                              </summary>

                              <pre className="mt-3 max-h-80 max-w-full overflow-y-auto whitespace-pre-wrap break-words text-xs text-slate-400">
                                {
                                  task.result_summary
                                }
                              </pre>
                            </details>
                          )}
                          {task.qa_summary && (
                            <details className="mt-3 min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
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

                              <pre className="mt-3 max-h-80 max-w-full overflow-y-auto whitespace-pre-wrap break-words text-xs text-slate-400">
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

                              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-amber-100">
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
                                <div className="mt-4 min-w-0 rounded-lg border border-sky-500/20 bg-slate-950/80 p-3 sm:p-4">
                                  <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-white">
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
                                        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(120px,100%),1fr))] gap-2">
                                          <div className="min-w-0 rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="line-clamp-2 break-normal text-[11px] uppercase leading-tight text-slate-500 [overflow-wrap:normal] [word-break:normal]">
                                              Ejecuciones
                                            </p>
                                            <strong className="mt-1 block max-w-full break-words text-sm tabular-nums text-white">
                                              {formatNumber(
                                                history.summary
                                                  .count,
                                              )}
                                            </strong>
                                          </div>

                                          <div className="min-w-0 rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="line-clamp-2 break-normal text-[11px] uppercase leading-tight text-slate-500 [overflow-wrap:normal] [word-break:normal]">
                                              Tokens entrada
                                            </p>
                                            <strong className="mt-1 block max-w-full break-words text-sm tabular-nums text-white">
                                              {formatNumber(
                                                history.summary
                                                  .inputTokens,
                                              )}
                                            </strong>
                                          </div>

                                          <div className="min-w-0 rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="line-clamp-2 break-normal text-[11px] uppercase leading-tight text-slate-500 [overflow-wrap:normal] [word-break:normal]">
                                              Tokens caché
                                            </p>
                                            <strong className="mt-1 block max-w-full break-words text-sm tabular-nums text-white">
                                              {formatNumber(
                                                history.summary
                                                  .cachedInputTokens,
                                              )}
                                            </strong>
                                          </div>

                                          <div className="min-w-0 rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="line-clamp-2 break-normal text-[11px] uppercase leading-tight text-slate-500 [overflow-wrap:normal] [word-break:normal]">
                                              Entrada no cacheada
                                            </p>
                                            <strong className="mt-1 block max-w-full break-words text-sm tabular-nums text-white">
                                              {formatNumber(
                                                history.summary
                                                  .nonCachedInputTokens,
                                              )}
                                            </strong>
                                          </div>

                                          <div className="min-w-0 rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="line-clamp-2 break-normal text-[11px] uppercase leading-tight text-slate-500 [overflow-wrap:normal] [word-break:normal]">
                                              Tokens salida
                                            </p>
                                            <strong className="mt-1 block max-w-full break-words text-sm tabular-nums text-white">
                                              {formatNumber(
                                                history.summary
                                                  .outputTokens,
                                              )}
                                            </strong>
                                          </div>

                                          <div className="min-w-0 rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="line-clamp-2 break-normal text-[11px] uppercase leading-tight text-slate-500 [overflow-wrap:normal] [word-break:normal]">
                                              Tokens totales
                                            </p>
                                            <strong className="mt-1 block max-w-full break-words text-sm tabular-nums text-white">
                                              {formatNumber(
                                                history.summary
                                                  .totalTokens,
                                              )}
                                            </strong>
                                          </div>

                                          <div className="min-w-0 rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="line-clamp-2 break-normal text-[11px] uppercase leading-tight text-slate-500 [overflow-wrap:normal] [word-break:normal]">
                                              Costo total
                                            </p>
                                            <strong className="mt-1 block max-w-full break-words text-sm tabular-nums text-white">
                                              {formatCost(
                                                history.summary
                                                  .costUsd,
                                              )}
                                            </strong>
                                          </div>

                                          <div className="min-w-0 rounded-lg border border-white/10 bg-white/5 p-3">
                                            <p className="line-clamp-2 break-normal text-[11px] uppercase leading-tight text-slate-500 [overflow-wrap:normal] [word-break:normal]">
                                              Duración total
                                            </p>
                                            <strong className="mt-1 block max-w-full break-words text-sm tabular-nums text-white">
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
                                          <div className="mt-4 min-w-0 space-y-3">
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
                                                    className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3"
                                                  >
                                                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                      <span
                                                        className={`rounded-full px-2 py-1 text-[11px] ${statusClass}`}
                                                      >
                                                        {
                                                          executionStatus
                                                        }
                                                      </span>

                                                      <span className="min-w-0 break-words text-xs font-medium text-slate-300">
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

                                                      <span className="min-w-0 break-words text-xs text-slate-500">
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

                                                    <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-2 text-xs text-slate-400">
                                                      <p className="min-w-0 break-words">
                                                        Proveedor:{" "}
                                                        <span className="text-slate-200">
                                                          {getProviderLabel(
                                                            pickValue(
                                                              execution,
                                                              [
                                                                "provider",
                                                                "provider_name",
                                                                "providerName",
                                                              ],
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>

                                                      <p className="min-w-0 break-words">
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

                                                      <p className="min-w-0 break-words">
                                                        Costo:{" "}
                                                        <span className="tabular-nums text-slate-200">
                                                          {formatCost(
                                                            getCostUsd(
                                                              execution,
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>

                                                      <p className="min-w-0 break-words">
                                                        Duración:{" "}
                                                        <span className="tabular-nums text-slate-200">
                                                          {formatDuration(
                                                            getDurationMs(
                                                              execution,
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>

                                                      <p className="min-w-0 break-words">
                                                        Tokens entrada:{" "}
                                                        <span className="tabular-nums text-slate-200">
                                                          {formatNumber(
                                                            getInputTokens(
                                                              execution,
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>

                                                      <p className="min-w-0 break-words">
                                                        Tokens caché:{" "}
                                                        <span className="tabular-nums text-slate-200">
                                                          {formatNumber(
                                                            getCachedInputTokens(
                                                              execution,
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>

                                                      <p className="min-w-0 break-words">
                                                        Entrada no cacheada:{" "}
                                                        <span className="tabular-nums text-slate-200">
                                                          {formatNumber(
                                                            getNonCachedInputTokens(
                                                              execution,
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>

                                                      <p className="min-w-0 break-words">
                                                        Tokens salida:{" "}
                                                        <span className="tabular-nums text-slate-200">
                                                          {formatNumber(
                                                            getOutputTokens(
                                                              execution,
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>

                                                      <p className="min-w-0 break-words">
                                                        Tokens totales:{" "}
                                                        <span className="tabular-nums text-slate-200">
                                                          {formatNumber(
                                                            getDisplayTotalTokens(
                                                              execution,
                                                            ),
                                                          )}
                                                        </span>
                                                      </p>
                                                    </div>

                                                    {errorMessage && (
                                                      <p className="mt-3 whitespace-pre-wrap break-words rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
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

                        <div className="flex min-w-0 flex-row flex-wrap items-center gap-2 sm:gap-3 xl:max-w-44 xl:flex-col xl:items-end">
                          <span className="min-w-0 break-words text-xs text-slate-500 xl:text-right">
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
                              disabled={
                                hasActiveAutomaticCycle
                              }
                              className="flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
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
      disabled={
        qaTaskId !== null ||
        hasActiveAutomaticCycle
      }
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
      {task.auto_correction_active
        ? getAutomaticCycleLabel(task)
        : "QA ejecutando"}
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
      disabled={
        hasActiveAutomaticCycle
      }
      className="flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
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
        correctionTaskId !== null ||
        hasActiveAutomaticCycle
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

                              {getProviderLabel(
                                task.provider,
                              )}{" "}
                              trabajando
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
          </>
        ) : activeTab === "specifications" ? (
          <SpecificationAssistant
            onUseSpecification={({ title, description }) => {
              setForm((current) => ({ ...current, title, description }));
              setActiveTab("operations");
            }}
          />
        ) : (
          <section>
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-cyan-400">
                  <FolderGit2 size={18} />

                  <span className="text-sm font-medium">
                    Administracion
                  </span>
                </div>

                <h2 className="mt-2 text-3xl font-bold text-white">
                  Proyectos
                </h2>

                <p className="mt-2 max-w-3xl text-slate-400">
                  Gestiona los proyectos disponibles para las nuevas
                  tareas. Los cambios se reflejan en el selector de
                  Operaciones al actualizarse el dashboard.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab("operations")}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-sky-400/50 hover:bg-sky-500/10"
              >
                <LayoutDashboard size={16} />
                Volver a Operaciones
              </button>
            </div>

            <ProjectManager onProjectsChanged={refreshDashboard} />
          </section>
        )}
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
