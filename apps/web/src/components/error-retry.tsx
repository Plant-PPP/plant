"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

// A page that failed to load: what happened, and the two ways on.
export function ErrorRetry({ retry }: { retry: () => void }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 text-center">
      <div className="bg-destructive/10 rounded-full p-4">
        <CircleAlert aria-hidden className="text-destructive size-8" />
      </div>
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Algo salió mal</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          No pudimos cargar esta página. Probá de nuevo en un momento.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" className="h-8 text-xs" onClick={() => retry()}>
          <RefreshCw />
          Probar de nuevo
        </Button>
        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
          <Link href="/">Ir al Resumen</Link>
        </Button>
      </div>
    </div>
  );
}
