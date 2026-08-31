"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import {
  DASHBOARD_PRESETS,
  PRESET_LABELS,
  type DashboardPreset,
} from "@/lib/dashboardDateRange";

import Select from "@/components/ui/Select";

interface DateRangePickerProps {
  current: DashboardPreset;
}

export default function DateRangePicker({ current }: DateRangePickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      const params = new URLSearchParams(searchParams.toString());

      if (value === "thisMonth") {
        params.delete("range");
      } else {
        params.set("range", value);
      }

      const qs = params.toString();
      router.push(qs ? `?${qs}` : "/dashboard", { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div className="w-full sm:w-auto sm:min-w-44">
      <Select
        id="dashboard-date-range"
        label="Date range"
        isLabelHidden
        value={current}
        onChange={handleChange}
        align="end"
        className="min-h-9 py-1 text-meta font-medium text-muted hover:border-line-strong"
      >
        {DASHBOARD_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {PRESET_LABELS[preset]}
          </option>
        ))}
      </Select>
    </div>
  );
}
