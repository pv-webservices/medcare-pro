"use client";

import { useState } from "react";
import { formatRupees, formatRupeesCompact } from "@/lib/money";
import type { RevenuePoint } from "@/lib/reports";

/**
 * Revenue trend — PRD §6.6 (FR-6.3).
 *
 * Inline SVG, no charting dependency: one line over time needs a path and an
 * axis, and CLAUDE.md says not to add to the stack without asking.
 *
 * Form and marks follow the house data-viz rules:
 *   - Trend over time, one series → a line. One series means NO legend box:
 *     the heading already says what is plotted, and a lone swatch would just
 *     restate it.
 *   - 2px line, round joins; area wash at 10%; an ≥8px end marker carrying a
 *     2px ring in the surface colour so it stays legible over the line.
 *   - Exactly one direct label, on the final point. A number on every point is
 *     noise; the axis, the tooltip and the table carry the rest.
 *   - Gridlines are solid hairlines one step off the surface — never dashed.
 *   - Colour lives on the mark. Every label is a text token, because a mid-blue
 *     is illegible as small text.
 *
 * The tooltip enhances, it never gates: the same numbers are in the table view
 * below, and the hit areas are focusable so a keyboard reaches what a pointer
 * reaches.
 */

interface GrowthChartProps {
  series: readonly RevenuePoint[];
  /** Names the series, so the chart needs no legend. */
  caption: string;
}

// Geometry is in viewBox units; the SVG scales to its container.
const WIDTH = 720;
const HEIGHT = 280;
const PADDING = { top: 16, right: 20, bottom: 38, left: 66 };

const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;
const GRID_LINES = 4;
/** Beyond this many ticks the labels collide, so only every nth is drawn. */
const MAX_TICKS = 7;

/** Rounds an axis maximum up to a clean number, so ticks read 0 / 250 / 500. */
function niceMax(value: number): number {
  if (value <= 0) {
    // An empty period still needs a scale, or every point sits on the axis.
    return 100;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;

  return step * magnitude;
}

export default function GrowthChart({ series, caption }: GrowthChartProps) {
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

  // Counted back from the end so the most recent bucket is always labelled.
  const tickStep = Math.max(1, Math.ceil(points.length / MAX_TICKS));
  const isTick = (index: number) => (points.length - 1 - index) % tickStep === 0;

  const lastIndex = points.length - 1;
  const active = activeIndex === null ? null : points[activeIndex];

  if (points.length === 0) {
    return null;
  }

  return (
    <div className="viz-root">
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${caption}. ${points.length} periods, from ${points[0].fullLabel} to ${points[lastIndex].fullLabel}. Values are listed in the table below.`}
        >
          {gridValues.map((value) => (
            <g key={value}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={yFor(value)}
                y2={yFor(value)}
                stroke="var(--viz-grid)"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 10}
                y={yFor(value) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--viz-muted)"
                style={{ fontVariantNumeric: "tnum" }}
              >
                {formatRupeesCompact(value)}
              </text>
            </g>
          ))}

          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={PADDING.top + PLOT_HEIGHT}
            y2={PADDING.top + PLOT_HEIGHT}
            stroke="var(--viz-axis)"
            strokeWidth={1}
          />

          <path d={areaPath} fill="var(--viz-series)" fillOpacity={0.1} />
          <path
            d={linePath}
            fill="none"
            stroke="var(--viz-series)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {points.map((point, index) =>
            isTick(index) ? (
              <text
                key={point.bucket}
                x={xFor(index)}
                y={HEIGHT - 14}
                textAnchor="middle"
                fontSize={11}
                fill="var(--viz-muted)"
              >
                {point.label}
              </text>
            ) : null,
          )}

          {/* Crosshair, drawn under the markers so it never covers one. */}
          {activeIndex !== null && (
            <line
              x1={xFor(activeIndex)}
              x2={xFor(activeIndex)}
              y1={PADDING.top}
              y2={PADDING.top + PLOT_HEIGHT}
              stroke="var(--viz-axis)"
              strokeWidth={1}
            />
          )}

          {/* The final point is the one the reader is looking for, so it is
              marked and labelled whether or not anything is hovered. */}
          <circle
            cx={xFor(lastIndex)}
            cy={yFor(points[lastIndex].value)}
            r={4}
            fill="var(--viz-series)"
            stroke="var(--viz-surface)"
            strokeWidth={2}
          />
          <text
            x={Math.min(xFor(lastIndex), WIDTH - PADDING.right - 4)}
            y={Math.max(yFor(points[lastIndex].value) - 12, PADDING.top + 10)}
            textAnchor="end"
            fontSize={12}
            fontWeight={600}
            fill="currentColor"
          >
            {formatRupeesCompact(points[lastIndex].value)}
          </text>

          {activeIndex !== null && activeIndex !== lastIndex && (
            <circle
              cx={xFor(activeIndex)}
              cy={yFor(points[activeIndex].value)}
              r={4}
              fill="var(--viz-series)"
              stroke="var(--viz-surface)"
              strokeWidth={2}
            />
          )}

          {/* Full-height hit columns: the target is the whole band, not the
              4px dot, and each is focusable so the keyboard gets the tooltip
              a pointer would. */}
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
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-canvas px-3 py-2 text-meta border border-line shadow-card"
            style={{
              left: `${(Math.min(Math.max(xFor(activeIndex), 90), WIDTH - 90) / WIDTH) * 100}%`,
              top: `${(yFor(active.value) / HEIGHT) * 100}%`,
            }}
          >
            <p className="font-semibold text-ink">{active.fullLabel}</p>
            <p className="mt-1 font-medium tnum text-ink">{formatRupees(active.revenue)}</p>
            <p className="text-muted mt-1">
              {active.registrations === 1
                ? "1 registration"
                : `${active.registrations} registrations`}
            </p>
          </div>
        )}
      </div>

      {/* The table view twin — every plotted value, reachable without hover. */}
      <details className="mt-4 group">
        <summary className="cursor-pointer text-body font-semibold text-muted hover:text-ink transition-colors list-none flex items-center">
          <span className="group-open:rotate-90 transition-transform mr-2">▶</span>
          View as table
        </summary>
        <div className="mt-3 overflow-x-auto rounded-xl border border-line shadow-card">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-line bg-canvas-deep/50">
                <th scope="col" className="py-3 pl-4 pr-4 text-body font-semibold text-ink">
                  Period
                </th>
                <th scope="col" className="py-3 pr-4 text-right text-body font-semibold text-ink">
                  Registrations
                </th>
                <th scope="col" className="py-3 pr-4 text-right text-body font-semibold text-ink">
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
                  <td className="py-3 pr-4 text-right text-body font-medium tnum text-ink">
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
