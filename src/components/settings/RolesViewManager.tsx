"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import RoleList from "@/components/settings/RoleList";
import UserRoleAssignments from "@/components/settings/UserRoleAssignments";
import EditRolePermissions from "@/components/settings/EditRolePermissions";
import type { RolesOverview } from "@/lib/roles";

interface RolesViewManagerProps {
  overview: RolesOverview;
}

export default function RolesViewManager({ overview }: RolesViewManagerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleIdParam = searchParams.get("roleId");

  // Local state initialized with query param if present
  const [editingRoleId, setEditingRoleId] = useState<string | null>(roleIdParam);

  // Synchronize when URL changes
  const activeRoleId = roleIdParam || editingRoleId;

  const editingRole = useMemo(
    () => overview.roles.find((r) => r.id === activeRoleId) ?? null,
    [overview.roles, activeRoleId],
  );

  const handleOpenEdit = (roleId: string) => {
    setEditingRoleId(roleId);
    const query = new URLSearchParams(window.location.search);
    query.set("roleId", roleId);
    router.push(`/settings/roles?${query.toString()}`, { scroll: true });
  };

  const handleBackToOverview = () => {
    setEditingRoleId(null);
    const query = new URLSearchParams(window.location.search);
    query.delete("roleId");
    const newQuery = query.toString();
    router.push(newQuery ? `/settings/roles?${newQuery}` : "/settings/roles", {
      scroll: true,
    });
  };

  if (editingRole) {
    return (
      <EditRolePermissions
        role={editingRole}
        grantablePermissions={overview.grantablePermissions}
        canManage={overview.canManage}
        onBack={handleBackToOverview}
        onSaved={() => {
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-10">
      <RoleList
        roles={overview.roles}
        grantablePermissions={overview.grantablePermissions}
        canManage={overview.canManage}
        onEditRole={handleOpenEdit}
      />

      <UserRoleAssignments
        users={overview.users}
        roles={overview.roles}
        clinics={overview.clinics}
        canManage={overview.canManage}
        canAssignAccountWide={overview.canAssignAccountWide}
      />
    </div>
  );
}
