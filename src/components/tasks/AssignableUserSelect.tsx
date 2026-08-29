"use client";

import { useEffect, useState } from "react";
import Select from "@/components/ui/Select";
import type { AssignableTaskUser } from "@/lib/tasks";

interface AssignableUserSelectProps {
  clinicId: string;
  value: string;
  onChange: (value: string) => void;
  initialUser?: AssignableTaskUser | null;
  disabled?: boolean;
}

export default function AssignableUserSelect({
  clinicId,
  value,
  onChange,
  initialUser,
  disabled,
}: AssignableUserSelectProps) {
  const [users, setUsers] = useState<AssignableTaskUser[]>(
    initialUser ? [initialUser] : [],
  );
  const [loadedClinicId, setLoadedClinicId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    const query = clinicId ? `?clinicId=${encodeURIComponent(clinicId)}` : "";

    void fetch(`/api/tasks/assignable-users${query}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) {
          throw new Error(body.error ?? "Could not load assignable users.");
        }
        const loaded = body.data as AssignableTaskUser[];
        if (initialUser && !loaded.some((user) => user.id === initialUser.id)) {
          loaded.unshift(initialUser);
        }
        setUsers(loaded);
        setError(undefined);
        setLoadedClinicId(clinicId);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setUsers(initialUser ? [initialUser] : []);
        setError(reason instanceof Error ? reason.message : "Could not load users.");
        setLoadedClinicId(clinicId);
      });

    return () => controller.abort();
  }, [clinicId, initialUser]);

  const loading = loadedClinicId !== clinicId;

  return (
    <Select
      id="task-assignee"
      label="Assign to"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || loading}
      error={error}
      hint={loading ? "Checking assignment authority…" : "Only valid assignees are shown."}
    >
      <option value="">Unassigned</option>
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {user.name || user.email}
        </option>
      ))}
    </Select>
  );
}
