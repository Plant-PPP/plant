import { TriangleAlert } from "lucide-react";

export function LeftOutNotice({ children }: { children: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-lg border border-amber-500/50 p-4 text-sm"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-amber-600" />
      {children}
    </p>
  );
}
