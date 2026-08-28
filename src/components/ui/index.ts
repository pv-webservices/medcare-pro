/**
 * MEDCARE PRO design system.
 *
 * Tokens live in src/app/globals.css; the rules for using them live in
 * .claude/skills/admin-dashboard-ui. Nothing outside this folder should
 * hand-roll a button, field, table, panel, pill, dialog or avatar — a screen
 * that invents its own is how eleven modules stop looking like one product.
 *
 * The two rules worth repeating here, because they are the ones that get broken:
 *
 *   1. A surface is WHITE with a HAIRLINE and a low shadow, on a cool grey page.
 *      Depth is never carried by a heavy drop shadow, and never by a second fill.
 *   2. One primary action per screen. Everything else is secondary or ghost.
 */

export { default as Avatar } from "@/components/ui/Avatar";
export type { AvatarSize } from "@/components/ui/Avatar";

export { default as Button, buttonClasses } from "@/components/ui/Button";
export type { ButtonSize, ButtonVariant } from "@/components/ui/Button";

export { default as Card } from "@/components/ui/Card";
export { default as Drawer } from "@/components/ui/Drawer";
export { default as EmptyState } from "@/components/ui/EmptyState";
export { default as FilterBar } from "@/components/ui/FilterBar";
export { default as IconButton } from "@/components/ui/IconButton";
export type { IconButtonSize, IconButtonTone } from "@/components/ui/IconButton";
export { default as Input, Textarea, FieldShell } from "@/components/ui/Input";

export {
  default as Menu,
  MenuLabel,
  MenuSeparator,
  menuItemClasses,
} from "@/components/ui/Menu";

export { default as MetricCard } from "@/components/ui/MetricCard";
export { default as Modal, ConfirmDialog } from "@/components/ui/Modal";
export { default as ModuleLocked } from "@/components/ui/ModuleLocked";
export { default as Pagination } from "@/components/ui/Pagination";

export {
  default as PageHeader,
  Breadcrumbs,
  Count,
} from "@/components/ui/PageHeader";
export type { Crumb } from "@/components/ui/PageHeader";

export { default as Panel } from "@/components/ui/Panel";
export { default as Select } from "@/components/ui/Select";

export {
  default as Skeleton,
  MetricSkeleton,
  SkeletonText,
  TableSkeleton,
} from "@/components/ui/Skeleton";

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

export { default as TabNav } from "@/components/ui/TabNav";
export type { TabItem } from "@/components/ui/TabNav";

export { default as Toggle } from "@/components/ui/Toggle";

export { ToastProvider, useToast } from "@/components/ui/Toast";
export type { ToastTone } from "@/components/ui/Toast";

export { cx } from "@/components/ui/cx";
