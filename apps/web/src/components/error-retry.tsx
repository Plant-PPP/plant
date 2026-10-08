"use client";

import { Button } from "@/components/ui/button";

export function ErrorRetry({ retry }: { retry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-lg font-semibold">Algo salió mal</h1>
      <Button variant="outline" size="sm" onClick={() => retry()}>
        Probar de nuevo
      </Button>
    </div>
  );
}
