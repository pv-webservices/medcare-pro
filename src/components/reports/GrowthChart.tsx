"use client";

import { ChevronDown, ChevronRight, TableProperties } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatRupees, formatRupeesCompact } from "@/lib/money";
import type { RevenuePoint } from "@/lib/reports";

interface GrowthChartProps {
  series: readonly RevenuePoint[];
  /** Names the series, so the chart needs no legend. */
  caption: string;
  actions?: ReactNode;
}

// Geometry is in viewBox units; the SVG scales to its container.
const WIDTH = 720;
const HEIGHT = 280;
const PADDING = { top: 24, right: 32, bottom: 38, left: 66 };

const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;
const GRID_LINES = 4;
/** Beyond this many ticks the labels collide, so only every nth is drawn. */
const MAX_TICKS = 7;

/** Rounds an axis maximum up to a clean number, so ticks read 0 / 250 / 500. */
function niceMax(value: number): number {
  if (value <= 0) {
    return 100;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;

  return step * magnitude;
}

export default function GrowthChart({
  series,
  caption,
  actions,
}: GrowthChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const points = series.length > 0 ? series : [];
  const maxValue = niceMax(Math.max(...points.map((point) => point.value), 0));

  const xFor = (index: number) =>
    points.length <= 1
      ? PADDING.left + PLOT_WIDTH / 2
      : PADDING.left + (index / (points.length - 1)) * PLOT_WIDTH;

  const yFor = (value: number) =>
    PADDING.top + PLOT_HEIGHT - (value / maxValue) * PLOT_HEIGHT;

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${xFor(index)},${yFor(point.value)}`)
    .join("");

  const areaPath =
    points.length === 0
      ? ""
      : `${linePath} L${xFor(points.length - 1)},${PADDING.top + PLOT_HEIGHT} L${xFor(0)},${PADDING.top + PLOT_HEIGHT} Z`;

  const gridValues = Array.from(
    { length: GRID_LINES + 1 },
    (_, step) => (maxValue / GRID_LINES) * step,
  );

  const tickStep = Math.max(1, Math.ceil(points.length / MAX_TICKS));
  const isTick = (index: number) => (points.length - 1 - index) % tickStep === 0;

  const lastIndex = points.length - 1;
  const active = activeIndex === null ? null : points[activeIndex];

  if (points.length === 0) {
    return null;
  }

  return (
    <div className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card">
      {/* Header with Title and Controls */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-ink">
            Revenue trend
          </h2>
          <p className="mt-0.5 text-label text-muted">
            {caption}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-canvas-deep/50 px-3 py-1.5 text-label font-medium text-ink">
            <span className="h-2 w-2 rounded-full bg-accent" />
            Total revenue
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 rounded-xl border border-line bg-canvas-deep/50 px-3 py-1.5 text-label font-medium text-ink">
            Line area
            <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
          </span>
          {actions}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label={`${caption}. ${points.length} periods, from ${points[0].fullLabel} to ${points[lastIndex].fullLabel}. Values are listed in the table below.`}
        >
          <defs>
            <linearGradient id="revenueTrendGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366F1" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#6366F1" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Gridlines and Y-axis labels */}
          {gridValues.map((value) => (
            <g key={value}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={yFor(value)}
                y2={yFor(value)}
                stroke="var(--line, #E2E8F0)"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 12}
                y={yFor(value) + 4}
                textAnchor="end"
                fontSize={11}
                fontWeight={500}
                fill="#64748B"
                style={{ fontVariantNumeric: "tnum" }}
              >
                {formatRupeesCompact(value)}
              </text>
            </g>
          ))}

          {/* Base Axis Line */}
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={PADDING.top + PLOT_HEIGHT}
            y2={PADDING.top + PLOT_HEIGHT}
            stroke="var(--line, #E2E8F0)"
            strokeWidth={1}
          />

          {/* Area & Stroke Paths */}
          <path d={areaPath} fill="url(#revenueTrendGrad)" />
          <path
            d={linePath}
            fill="none"
            stroke="#6366F1"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* X-axis Ticks */}
          {points.map((point, index) =>
            isTick(index) ? (
              <text
                key={point.bucket}
                x={xFor(index)}
                y={HEIGHT - 14}
                textAnchor="middle"
                fontSize={11}
                fontWeight={500}
                fill="#64748B"
              >
                {point.label}
              </text>
            ) : null,
          )}

          {/* Subtle Data Points and Point Values */}
          {points.map((point, index) => {
            if (index === lastIndex) return null;
            return (
              <g key={`pt-${point.bucket}`}>
                <text
                  x={xFor(index)}
                  y={yFor(point.value) - 10}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="#1E293B"
                  style={{ fontVariantNumeric: "tnum" }}
                >
                  {formatRupeesCompact(point.value)}
                </text>
                <circle
                  cx={xFor(index)}
                  cy={yFor(point.value)}
                  r={3.5}
                  fill="#6366F1"
                  stroke="#FFFFFF"
                  strokeWidth={2}
                />
              </g>
            );
          })}

          {/* Crosshair when hovering */}
          {activeIndex !== null && (
            <line
              x1={xFor(activeIndex)}
              x2={xFor(activeIndex)}
              y1={PADDING.top}
              y2={PADDING.top + PLOT_HEIGHT}
              stroke="#94A3B8"
              strokeDasharray="2 2"
              strokeWidth={1}
            />
          )}

          {/* Final Point Glowing Ring and Pin */}
          <circle
            cx={xFor(lastIndex)}
            cy={yFor(points[lastIndex].value)}
            r={8}
            fill="#6366F1"
            fillOpacity={0.25}
          />
          <circle
            cx={xFor(lastIndex)}
            cy={yFor(points[lastIndex].value)}
            r={4.5}
            fill="#4F46E5"
            stroke="#FFFFFF"
            strokeWidth={2}
          />

          {/* Highlight Badge on Latest Value */}
          <g
            transform={`translate(${Math.min(xFor(lastIndex), WIDTH - PADDING.right - 26)}, ${Math.max(
              yFor(points[lastIndex].value) - 20,
              PADDING.top + 6,
            )})`}
          >
            <rect
              x={-28}
              y={-14}
              width={56}
              height={22}
              rx={11}
              fill="#0F172A"
            />
            <text
              x={0}
              y={1}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fontWeight={700}
              fill="#FFFFFF"
            >
              {formatRupeesCompact(points[lastIndex].value)}
            </text>
          </g>

          {activeIndex !== null && activeIndex !== lastIndex && (
            <circle
              cx={xFor(activeIndex)}
              cy={yFor(points[activeIndex].value)}
              r={4}
              fill="#4F46E5"
              stroke="#FFFFFF"
              strokeWidth={2}
            />
          )}

          {/* Focusable Interactive Hit Bands */}
          {points.map((point, index) => {
            const bandWidth = PLOT_WIDTH / Math.max(points.length - 1, 1);

            return (
              <rect
                key={point.bucket}
                x={xFor(index) - bandWidth / 2}
                y={PADDING.top}
                width={bandWidth}
                height={PLOT_HEIGHT}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${point.fullLabel}: ${formatRupees(point.revenue)} from ${point.registrations} registrations`}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                onBlur={() => setActiveIndex(null)}
              />
            );
          })}
        </svg>

        {active && activeIndex !== null && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-2xl bg-canvas px-3.5 py-2.5 text-meta border border-line shadow-card"
            style={{
              left: `${(Math.min(Math.max(xFor(activeIndex), 90), WIDTH - 90) / WIDTH) * 100}%`,
              top: `${(yFor(active.value) / HEIGHT) * 100}%`,
            }}
          >
            <p className="font-semibold text-ink">{active.fullLabel}</p>
            <p className="mt-1 font-bold tnum text-ink">{formatRupees(active.revenue)}</p>
            <p className="text-muted mt-0.5 text-label">
              {active.registrations === 1
                ? "1 registration"
                : `${active.registrations} registrations`}
            </p>
          </div>
        )}
      </div>

      {/* Accessible Table View Toggle */}
      <details className="mt-6 group">
        <summary className="cursor-pointer inline-flex items-center gap-2 rounded-xl border border-line bg-canvas px-3.5 py-1.5 text-label font-medium text-ink shadow-sm hover:bg-canvas-deep transition-colors list-none">
          <TableProperties className="h-4 w-4 text-muted" aria-hidden="true" />
          <span>View as table</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
        </summary>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-canvas shadow-sm">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-line bg-canvas-deep/50">
                <th scope="col" className="py-3 pl-4 pr-4 text-label font-semibold uppercase text-muted">
                  Period
                </th>
                <th scope="col" className="py-3 pr-4 text-right text-label font-semibold uppercase text-muted">
                  Registrations
                </th>
                <th scope="col" className="py-3 pr-4 text-right text-label font-semibold uppercase text-muted">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr
                  key={point.bucket}
                  className="border-b border-line last:border-0 hover:bg-canvas-deep/50 transition-colors"
                >
                  <td className="py-3 pl-4 pr-4 text-body font-medium text-ink">{point.fullLabel}</td>
                  <td className="py-3 pr-4 text-right text-body tnum text-muted">
                    {point.registrations}
                  </td>
                  <td className="py-3 pr-4 text-right text-body font-bold tnum text-ink">
                    {formatRupees(point.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
