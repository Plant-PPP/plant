import { Skeleton } from "@/components/ui/skeleton";

// What a page shows while the server reads its data: its header's row, a row
// of figures and a table, in the places the page will fill.
export function PageSkeleton() {
  return (
    <div className="grid gap-8" role="status" aria-busy="true">
      <span className="sr-only">Cargando…</span>
      <div className="grid gap-4">
        <div className="flex min-h-7 items-center gap-1.5">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-7 w-28" />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((each) => (
            <Skeleton key={each} className="h-[5.5rem] rounded-lg" />
          ))}
        </div>
      </div>
      <div className="grid gap-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}
