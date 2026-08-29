"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Button from "@/components/ui/Button";
import FilterBar from "@/components/ui/FilterBar";
import Select from "@/components/ui/Select";

interface TaskFiltersProps {
  clinics: readonly { id: string; name: string }[];
  canManage: boolean;
  initial: { view: string; clinicId: string; status: string; priority: string; due: string };
}

export default function TaskFilters({ clinics, canManage, initial }: TaskFiltersProps) {
  const router = useRouter();
  const [values, setValues] = useState(initial);

  function submit(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (value && !(key === "view" && value === "mine")) params.set(key, value);
    });
    router.push(params.size ? `/tasks?${params}` : "/tasks");
  }

  return (
    <form onSubmit={submit}>
      <FilterBar
        activeCount={Object.values(values).filter(Boolean).length - (values.view === "mine" ? 1 : 0)}
        actions={<Button type="submit" size="sm" variant="primary">Apply</Button>}
        clearAction={<Button size="sm" variant="ghost" onClick={() => { setValues({ view: "mine", clinicId: "", status: "", priority: "", due: "" }); router.push("/tasks"); }}>Clear</Button>}
      >
        <Select id="task-filter-view" label="View" value={values.view} onChange={(event) => setValues({ ...values, view: event.target.value })}>
          <option value="mine">My tasks</option>
          <option value="created">Created by me</option>
          {canManage && <option value="all">All clinic tasks</option>}
        </Select>
        <Select id="task-filter-clinic" label="Clinic" value={values.clinicId} onChange={(event) => setValues({ ...values, clinicId: event.target.value })}>
          <option value="">All allowed clinics</option>
          {clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
        </Select>
        <Select id="task-filter-status" label="Status" value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>
          <option value="">Any status</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
        <Select id="task-filter-priority" label="Priority" value={values.priority} onChange={(event) => setValues({ ...values, priority: event.target.value })}>
          <option value="">Any priority</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </Select>
        <Select id="task-filter-due" label="Due" value={values.due} onChange={(event) => setValues({ ...values, due: event.target.value })}>
          <option value="">Any due date</option>
          <option value="today">Due today</option>
          <option value="overdue">Overdue</option>
          <option value="upcoming">Upcoming</option>
        </Select>
      </FilterBar>
    </form>
  );
}

