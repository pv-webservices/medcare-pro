/**
 * MEDCARE PRO design system — UI Stage 0.
 *
 * Tokens live in src/app/globals.css; the rules for using them live in
 * .claude/skills/admin-dashboard-ui. Nothing outside this folder should
 * hand-roll a button, field, table, panel or pill.
 */

export { default as Button, buttonClasses } from "@/components/ui/Button";
export type { ButtonSize, ButtonVariant } from "@/components/ui/Button";

export { default as Card } from "@/components/ui/Card";
export { default as EmptyState } from "@/components/ui/EmptyState";
export { default as Input, Textarea, FieldShell } from "@/components/ui/Input";
export { default as ModuleLocked } from "@/components/ui/ModuleLocked";
export { default as PageHeader, Count } from "@/components/ui/PageHeader";
export { default as Panel } from "@/components/ui/Panel";
export { default as Select } from "@/components/ui/Select";
export { default as StatusPill } from "@/components/ui/StatusPill";
export type { StatusTone } from "@/components/ui/StatusPill";

export {
  default as Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/Table";

export { ToastProvider, useToast } from "@/components/ui/Toast";
export type { ToastTone } from "@/components/ui/Toast";

export { cx } from "@/components/ui/cx";
