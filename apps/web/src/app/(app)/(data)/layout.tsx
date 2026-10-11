import type { ReactNode } from "react";

import { PrototypeRoot } from "@/components/prototype/prototype-root";
import { isProductionDeployment } from "@/lib/deployment";

// The pages over the user's holdings, debts and history. Outside production
// they show made-up data held in the browser instead.
export default function DataLayout({ children }: { children: ReactNode }) {
  return isProductionDeployment() ? (
    children
  ) : (
    <PrototypeRoot>{children}</PrototypeRoot>
  );
}
