import {
  Briefcase,
  Crown,
  Shield,
  Stethoscope,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface RoleVisual {
  icon: LucideIcon;
  bgColor: string;
  textColor: string;
  borderColor: string;
  badgeBg: string;
  badgeText: string;
  description: string;
}

export function getRoleVisual(roleName: string, isWildcard = false): RoleVisual {
  const normalized = roleName.trim().toLowerCase();

  if (isWildcard || normalized === "owner") {
    return {
      icon: Crown,
      bgColor: "bg-[#f59e0b] text-white",
      textColor: "text-[#f59e0b]",
      borderColor: "border-amber-200",
      badgeBg: "bg-amber-50",
      badgeText: "text-amber-700",
      description:
        "The organisation's root. Holds every permission, including any added later.",
    };
  }

  if (normalized.includes("admin")) {
    return {
      icon: Shield,
      bgColor: "bg-[#5b4bff] text-white",
      textColor: "text-[#5b4bff]",
      borderColor: "border-indigo-200",
      badgeBg: "bg-indigo-50",
      badgeText: "text-indigo-700",
      description:
        "Full access to manage clinics, users, data and system settings.",
    };
  }

  if (normalized.includes("doctor") || normalized.includes("physician")) {
    return {
      icon: Stethoscope,
      bgColor: "bg-[#3b82f6] text-white",
      textColor: "text-[#3b82f6]",
      borderColor: "border-blue-200",
      badgeBg: "bg-blue-50",
      badgeText: "text-blue-700",
      description:
        "Clinical read access. Sees patients and visits, but does not create or edit them.",
    };
  }

  if (normalized.includes("executive")) {
    return {
      icon: Briefcase,
      bgColor: "bg-[#06b6d4] text-white",
      textColor: "text-[#06b6d4]",
      borderColor: "border-cyan-200",
      badgeBg: "bg-cyan-50",
      badgeText: "text-cyan-700",
      description:
        "Executive oversight. View clinic operations, performance, and key metrics.",
    };
  }

  if (normalized.includes("reception")) {
    return {
      icon: UserCheck,
      bgColor: "bg-[#22c55e] text-white",
      textColor: "text-[#22c55e]",
      borderColor: "border-emerald-200",
      badgeBg: "bg-emerald-50",
      badgeText: "text-emerald-700",
      description:
        "The front desk. Registers patients, records visits, and sends WhatsApp confirmations.",
    };
  }

  if (normalized.includes("staff")) {
    return {
      icon: Users,
      bgColor: "bg-[#ec4899] text-white",
      textColor: "text-[#ec4899]",
      borderColor: "border-pink-200",
      badgeBg: "bg-pink-50",
      badgeText: "text-pink-700",
      description:
        "General clinic staff. Can register patients and record visits.",
    };
  }

  // Fallback for custom roles
  return {
    icon: Shield,
    bgColor: "bg-[#64748b] text-white",
    textColor: "text-[#64748b]",
    borderColor: "border-slate-200",
    badgeBg: "bg-slate-50",
    badgeText: "text-slate-700",
    description: "Custom role created for this organisation.",
  };
}
