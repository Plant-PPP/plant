import type { ReactNode } from "react";
import { BrandLogo } from "@/components/layout/brand-logo";

// A centered card under the logo, for the steps after sign-in. The login page
// keeps its own two columns for the showcase panel.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <BrandLogo variant="logotype" className="h-7 w-auto self-center" />
        {children}
      </div>
    </main>
  );
}
