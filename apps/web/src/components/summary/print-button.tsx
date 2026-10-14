"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

// Opens the browser's print dialog, where the page saves as a PDF.
export function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-9"
      onClick={() => window.print()}
    >
      <Printer />
      Guardar en PDF
    </Button>
  );
}
