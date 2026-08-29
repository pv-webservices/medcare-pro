import { redirect } from "next/navigation";
import TaskFilters from "@/components/tasks/TaskFilters";
import TaskForm from "@/components/tasks/TaskForm";
import TasksTable from "@/components/tasks/TasksTable";
import ModuleLocked from "@/components/ui/ModuleLocked";
import PageHeader, { Count } from "@/components/ui/PageHeader";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";
import { PermissionError } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import {
  listTaskClinics,
  listTasks,
  taskFilterSchema,
  taskPageCapabilities,
  type TaskFilters as Filters,
} from "@/lib/tasks";

interface TasksPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) redirect("/login");
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.tasks);
  if (locked) return <ModuleLocked title="Tasks" reason={locked} />;

  const params = await searchParams;
  let filters: Filters;
  try {
    filters = taskFilterSchema.parse({
      view: single(params.view),
      clinicId: single(params.clinicId),
      status: single(params.status),
      priority: single(params.priority),
      due: single(params.due),
    });
  } catch {
    filters = taskFilterSchema.parse({});
  }

  let loaded:
    | [
        Awaited<ReturnType<typeof listTasks>>,
        Awaited<ReturnType<typeof listTaskClinics>>,
        Awaited<ReturnType<typeof taskPageCapabilities>>,
      ]
    | null = null;
  try {
    loaded = await Promise.all([
      listTasks(actor, filters),
      listTaskClinics(actor),
      taskPageCapabilities(actor),
    ]);
  } catch (error: unknown) {
    if (!(error instanceof PermissionError)) throw error;
  }

  if (!loaded) {
    return (
      <section className="space-y-4">
        <PageHeader title="Tasks" description="Assign and track work across your clinic team." />
        <div className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
          Your role cannot view tasks. Ask the account owner if you need access.
        </div>
      </section>
    );
  }

  const [result, clinics, capabilities] = loaded;
  const isFiltered = Boolean(
    filters.view !== "mine" || filters.clinicId || filters.status || filters.priority || filters.due,
  );

  return (
    <section className="space-y-4">
      <PageHeader
        title="Tasks"
        description="Assign and track work across your clinic team."
        meta={<><Count>{result.total}</Count> {result.total === 1 ? "task" : "tasks"} in this view</>}
        actions={capabilities.canCreate ? <TaskForm clinics={clinics} canCreateTenantWide={capabilities.canCreateTenantWide} /> : undefined}
      />
      <TaskFilters
        clinics={clinics}
        canManage={capabilities.canManage}
        initial={{
          view: filters.view,
          clinicId: filters.clinicId ?? "",
          status: filters.status ?? "",
          priority: filters.priority ?? "",
          due: filters.due ?? "",
        }}
      />
      <TasksTable tasks={result.rows} clinics={clinics} isFiltered={isFiltered} />
    </section>
  );
}
