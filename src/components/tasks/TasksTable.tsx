import { ListTodo } from "lucide-react";
import TaskStatusActions from "@/components/tasks/TaskStatusActions";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill, { type StatusTone } from "@/components/ui/StatusPill";
import Table, { TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { TaskListItem } from "@/lib/tasks";

const STATUS: Record<TaskListItem["status"], { label: string; tone: StatusTone }> = {
  OPEN: { label: "Open", tone: "info" },
  IN_PROGRESS: { label: "In progress", tone: "accent" },
  COMPLETED: { label: "Completed", tone: "ok" },
  CANCELLED: { label: "Cancelled", tone: "alert" },
};
const PRIORITY: Record<TaskListItem["priority"], { label: string; tone: StatusTone }> = {
  LOW: { label: "Low", tone: "neutral" },
  MEDIUM: { label: "Medium", tone: "info" },
  HIGH: { label: "High", tone: "warn" },
  URGENT: { label: "Urgent", tone: "alert" },
};

function person(person: TaskListItem["assignedTo"]): string {
  return person ? person.name || person.email : "Unassigned";
}

function date(value: string | null, withTime = false): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

interface TasksTableProps {
  tasks: readonly TaskListItem[];
  clinics: readonly { id: string; name: string }[];
  isFiltered: boolean;
}

export default function TasksTable({ tasks, clinics, isFiltered }: TasksTableProps) {
  if (!tasks.length) {
    return <EmptyState icon={<ListTodo className="h-5 w-5" />} title={isFiltered ? "No tasks match these filters" : "No tasks yet"} guidance={isFiltered ? "Clear or change a filter to widen the list." : "Create a task to start coordinating clinic work."} />;
  }

  return (
    <>
      <div className="hidden xl:block">
        <Table caption="Tasks with status, assignment, clinic and due date">
          <THead><TH>Task</TH><TH>Status</TH><TH>Priority</TH><TH>Assigned to</TH><TH>Created by</TH><TH>Clinic</TH><TH>Due</TH><TH>Updated</TH><TH align="end"><span className="sr-only">Actions</span></TH></THead>
          <TBody>
            {tasks.map((task) => (
              <TR key={task.id}>
                <TD><p className="max-w-64 font-semibold text-ink">{task.title}</p>{task.description && <p className="mt-0.5 max-w-64 truncate text-meta text-muted">{task.description}</p>}</TD>
                <TD><StatusPill tone={STATUS[task.status].tone}>{STATUS[task.status].label}</StatusPill></TD>
                <TD><StatusPill tone={PRIORITY[task.priority].tone}>{PRIORITY[task.priority].label}</StatusPill></TD>
                <TD>{person(task.assignedTo)}</TD><TD>{task.createdBy.name || task.createdBy.email}</TD><TD>{task.clinic?.name ?? "All clinics"}</TD><TD><span className="tnum whitespace-nowrap">{date(task.dueAt, true)}</span></TD><TD><span className="tnum whitespace-nowrap">{date(task.updatedAt)}</span></TD>
                <TD align="end"><TaskStatusActions task={task} clinics={clinics} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <ul className="grid gap-3 xl:hidden">
        {tasks.map((task) => (
          <li key={task.id}><Card className="p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-ink">{task.title}</h3><p className="mt-1 text-meta text-muted">{person(task.assignedTo)} · {task.clinic?.name ?? "All clinics"}</p></div><StatusPill tone={STATUS[task.status].tone}>{STATUS[task.status].label}</StatusPill></div>{task.description && <p className="mt-3 line-clamp-2 text-body text-muted">{task.description}</p>}<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3"><div className="flex items-center gap-2"><StatusPill tone={PRIORITY[task.priority].tone}>{PRIORITY[task.priority].label}</StatusPill><span className="text-meta text-muted">Due {date(task.dueAt, true)}</span></div><TaskStatusActions task={task} clinics={clinics} /></div></Card></li>
        ))}
      </ul>
    </>
  );
}

