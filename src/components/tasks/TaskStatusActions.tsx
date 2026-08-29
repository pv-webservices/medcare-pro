"use client";

import { Archive, Check, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import TaskForm from "@/components/tasks/TaskForm";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { TaskListItem } from "@/lib/tasks";

interface TaskStatusActionsProps {
  task: TaskListItem;
  clinics: readonly { id: string; name: string }[];
}

export default function TaskStatusActions({ task, clinics }: TaskStatusActionsProps) {
  const router = useRouter();
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function action(path: string, body?: object) {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: body ? "PATCH" : "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "Task update failed.");
      }
      setConfirmArchive(false);
      showToast({ tone: "ok", title: "Task updated." });
      router.refresh();
    } catch (reason: unknown) {
      showToast({
        tone: "alert",
        title: "Task update failed.",
        detail: reason instanceof Error ? reason.message : "Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {task.canEdit && task.status === "OPEN" && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(`/api/tasks/${task.id}`, { status: "IN_PROGRESS" })}>
          Start
        </Button>
      )}
      {task.canComplete && task.status !== "COMPLETED" && task.status !== "CANCELLED" && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void action(`/api/tasks/${task.id}/complete`)}>
          <Check className="h-4 w-4" /> Complete
        </Button>
      )}
      {task.canEdit && task.status !== "COMPLETED" && task.status !== "CANCELLED" && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(`/api/tasks/${task.id}`, { status: "CANCELLED" })}>
          <XCircle className="h-4 w-4" />
          <span className="sr-only">Cancel {task.title}</span>
        </Button>
      )}
      {task.canEdit && <TaskForm task={task} clinics={clinics} />}
      {task.canArchive && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmArchive(true)}>
          <Archive className="h-4 w-4" />
          <span className="sr-only">Archive {task.title}</span>
        </Button>
      )}
      <ConfirmDialog
        isOpen={confirmArchive}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => void action(`/api/tasks/${task.id}/archive`)}
        title="Archive task?"
        body={<>Archive <strong>{task.title}</strong>. It will leave active task lists.</>}
        confirmLabel="Archive task"
        isBusy={busy}
      />
    </div>
  );
}
