"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import AssignableUserSelect from "@/components/tasks/AssignableUserSelect";
import Button from "@/components/ui/Button";
import Input, { Textarea } from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import type { AssignableTaskUser, TaskListItem } from "@/lib/tasks";

interface TaskFormProps {
  clinics: readonly { id: string; name: string }[];
  canCreateTenantWide?: boolean;
  task?: TaskListItem;
}

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function TaskForm({
  clinics,
  canCreateTenantWide = false,
  task,
}: TaskFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [clinicId, setClinicId] = useState(task?.clinic?.id ?? clinics[0]?.id ?? "");
  const [assignedToId, setAssignedToId] = useState(task?.assignedTo?.id ?? "");

  const initialUser = useMemo<AssignableTaskUser | null>(
    () =>
      task?.assignedTo
        ? {
            id: task.assignedTo.id,
            name: task.assignedTo.name,
            email: task.assignedTo.email,
          }
        : null,
    [task],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    const dueValue = String(data.get("dueAt") ?? "");
    const payload = {
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? "") || null,
      priority: String(data.get("priority") ?? "MEDIUM"),
      dueAt: dueValue ? new Date(dueValue).toISOString() : null,
      assignedToId: assignedToId || null,
      ...(task ? {} : { clinicId: clinicId || null }),
    };

    try {
      const response = await fetch(task ? `/api/tasks/${task.id}` : "/api/tasks", {
        method: task ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error ?? "Could not save task.");
      setOpen(false);
      router.refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not save task.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant={task ? "ghost" : "primary"}
        size={task ? "sm" : "md"}
        onClick={() => setOpen(true)}
      >
        {task ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {task ? "Edit" : "New task"}
      </Button>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={task ? "Edit task" : "Create a task"}
        description="Assignment options are checked again by the server when you save."
        size="lg"
        isBusy={busy}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={task ? `task-form-${task.id}` : "task-create-form"}
              variant="primary"
              isBusy={busy}
              busyLabel="Saving…"
            >
              {task ? "Save changes" : "Create task"}
            </Button>
          </>
        }
      >
        <form
          id={task ? `task-form-${task.id}` : "task-create-form"}
          onSubmit={handleSubmit}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Input
            id={`task-title-${task?.id ?? "new"}`}
            name="title"
            label="Title"
            maxLength={160}
            required
            defaultValue={task?.title ?? ""}
            fieldClassName="sm:col-span-2"
          />
          <Textarea
            id={`task-description-${task?.id ?? "new"}`}
            name="description"
            label="Description"
            maxLength={5000}
            defaultValue={task?.description ?? ""}
            fieldClassName="sm:col-span-2"
          />
          {!task && (
            <Select
              id="task-clinic"
              label="Clinic"
              value={clinicId}
              onChange={(event) => {
                setClinicId(event.target.value);
                setAssignedToId("");
              }}
              required={!canCreateTenantWide}
            >
              {canCreateTenantWide && <option value="">All clinics</option>}
              {clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
              ))}
            </Select>
          )}
          <Select
            id={`task-priority-${task?.id ?? "new"}`}
            name="priority"
            label="Priority"
            defaultValue={task?.priority ?? "MEDIUM"}
          >
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </Select>
          <Input
            id={`task-due-${task?.id ?? "new"}`}
            name="dueAt"
            label="Due date and time"
            type="datetime-local"
            defaultValue={localDateTime(task?.dueAt ?? null)}
          />
          <div className="sm:col-span-2">
            <AssignableUserSelect
              clinicId={task?.clinic?.id ?? clinicId}
              value={assignedToId}
              onChange={setAssignedToId}
              initialUser={initialUser}
            />
          </div>
          {error && (
            <p role="alert" className="sm:col-span-2 rounded-2xl border border-alert-line bg-alert-bg px-4 py-3 text-body text-alert-ink">
              {error}
            </p>
          )}
        </form>
      </Modal>
    </>
  );
}

