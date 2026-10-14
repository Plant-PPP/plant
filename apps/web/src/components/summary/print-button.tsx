"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

// Opens the browser's print dialog, where the page saves as a PDF. The page
// prints in the light theme, since paper has no dark background.
export function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-9"
      onClick={() => {
        const root = document.documentElement;
        const dark = root.classList.contains("dark");
        if (dark) root.classList.remove("dark");
        try {
          window.print();
        } finally {
          if (dark) root.classList.add("dark");
        }
      }}
    >
      <Printer />
      Guardar en PDF
    </Button>
  );
}
