import { cx } from "@/components/ui/cx";

/**
 * A single-series area chart, in plain SVG.
 *
 * NO CHARTING DEPENDENCY, on purpose. CLAUDE.md says not to add to the stack
 * without asking, and one line over time needs a path, a wash and some labels —
 * which is about forty lines of geometry. The revenue trend in
 * components/reports/GrowthChart.tsx makes the same call and follows the same
 * house rules; this is its smaller sibling for the dashboard overview.
 *
 * The house data-viz rules it follows:
 *   - Trend over time, one series → a line with a wash beneath it. One series
 *     means NO legend: the panel heading already says what is plotted, and a
 *     lone swatch would only restate it.
 *   - Gridlines are horizontal only, one hairline step off the canvas, solid
 *     rather than dashed. No axis rules at all — the gridlines already imply
 *     the frame, and a box around a chart is ink that encodes nothing.
 *   - Colour lives on the mark. Every label is a text token, because a
 *     saturated teal is illegible at 11px.
 *
 * PURELY PRESENTATIONAL. It takes its data as a prop and holds no state, so it
 * stays a server component and ships no JavaScript.
 */

export interface AreaPoint {
  /** Axis label — a month or a weekday, already formatted for display. */
  label: string;
  value: number;
}

interface AreaChartProps {
  points: readonly AreaPoint[];
  /** Describes the series for a screen reader, since the SVG itself cannot. */
  caption: string;
  className?: string;
}

// Geometry is in viewBox units; the SVG scales to whatever box it is given.
const WIDTH = 720;
const HEIGHT = 260;
const PADDING = { top: 16, right: 8, bottom: 30, left: 8 };

const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;
const GRID_LINES = 4;

/**
 * Rounds the axis maximum up to a clean number so the top gridline lands on a
 * value a human would say out loud, and adds ~10% headroom so the peak of the
 * curve is not welded to the top of the frame.
 */
function niceMax(value: number): number {
  if (value <= 0) {
    // An empty period still needs a scale, or every point sits on the axis.
    return 100;
  }

  const padded = value * 1.1;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  const normalised = padded / magnitude;
  const step =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;

  return step * magnitude;
}

/**
 * A monotone cubic through the points.
 *
 * Straight segments make seven months of patient counts look like a seismograph;
 * a smooth curve reads as a trend, which is what the panel is for. The control
 * points are horizontal-only (a Catmull-Rom-style tangent flattened to the x
 * axis), so the curve cannot overshoot above a peak or below a trough and
 * invent a value that is not in the data.
 */
function curveThrough(coordinates: readonly { x: number; y: number }[]): string {
  if (coordinates.length === 0) {
    return "";
  }
  if (coordinates.length === 1) {
    return `M${coordinates[0].x},${coordinates[0].y}`;
  }

  let path = `M${coordinates[0].x},${coordinates[0].y}`;

  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    const midpoint = (previous.x + current.x) / 2;

    path += ` C${midpoint},${previous.y} ${midpoint},${current.y} ${current.x},${current.y}`;
  }

  return path;
}

export default function AreaChart({
  points,
  caption,
  className,
}: AreaChartProps) {
  const maxValue = niceMax(Math.max(...points.map((point) => point.value), 0));

  const xFor = (index: number) =>
    points.length <= 1
      ? PADDING.left + PLOT_WIDTH / 2
      : PADDING.left + (index / (points.length - 1)) * PLOT_WIDTH;

  const yFor = (value: number) =>
    PADDING.top + PLOT_HEIGHT - (value / maxValue) * PLOT_HEIGHT;

  const coordinates = points.map((point, index) => ({
    x: xFor(index),
    y: yFor(point.value),
  }));

  const linePath = curveThrough(coordinates);
  const baseline = PADDING.top + PLOT_HEIGHT;
  const areaPath =
    coordinates.length > 0
      ? `${linePath} L${coordinates[coordinates.length - 1].x},${baseline} L${coordinates[0].x},${baseline} Z`
      : "";

  return (
    <figure className={cx("viz-root m-0", className)}>
      <figcaption className="sr-only">{caption}</figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        // The chart is decoration over data that is also in the table below it;
        // the caption above carries the meaning for anyone who cannot see it.
        role="img"
        aria-label={caption}
        className="h-52 w-full sm:h-56"
        preserveAspectRatio="none"
      >
        {Array.from({ length: GRID_LINES + 1 }, (_, index) => {
          const y = PADDING.top + (index / GRID_LINES) * PLOT_HEIGHT;
          return (
            <line
              key={index}
              x1={PADDING.left}
              y1={y}
              x2={WIDTH - PADDING.right}
              y2={y}
              stroke="var(--viz-grid)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {areaPath && <path d={areaPath} fill="var(--viz-series)" fillOpacity="0.07" />}

        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--viz-series)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/*
        The month labels are HTML rather than SVG <text>. preserveAspectRatio is
        off so the plot can stretch to any panel width, which would stretch text
        with it; laying the labels out in a flex row keeps them at their true
        size and correctly kerned at every breakpoint.
      */}
      <div className="mt-2 flex justify-between px-1">
        {points.map((point, index) => (
          <span
            key={`${point.label}-${index}`}
            className="text-micro font-semibold uppercase text-muted"
          >
            {point.label}
          </span>
        ))}
      </div>

      <ul className="sr-only">
        {points.map((point, index) => (
          <li key={`${point.label || "point"}-${index}`}>{point.label || `Point ${index + 1}`}: {point.value}</li>
        ))}
      </ul>
    </figure>
  );
}
