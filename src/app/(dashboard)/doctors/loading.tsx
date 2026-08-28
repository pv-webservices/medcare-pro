import { TableSkeleton } from "@/components/ui/Skeleton";

/**
 * What doctors looks like while it loads.
 *
 * THE SHAPE OF THE SCREEN THAT IS COMING, not a spinner. The row count and the
 * column count are approximate on purpose — close enough that the real content
 * lands without the page jumping, not so exact that this file has to be updated
 * every time a column moves.
 *
 * The region is `aria-busy`, and the placeholders inside it are hidden from
 * assistive technology, so a screen reader hears "loading" once instead of
 * reading out forty empty boxes.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <div className="space-y-2">
        <span aria-hidden="true" className="skeleton block h-7 w-52" />
        <span aria-hidden="true" className="skeleton block h-3.5 w-80 max-w-full" />
      </div>
      <TableSkeleton rows={6} columns={4} />
    </div>
  );
}
