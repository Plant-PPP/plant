import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PrototypeImportReview } from "@/components/prototype/prototype-imports";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/import") };

// An import's review. Imports exist only in the made-up data so far, so
// production has no such page yet.
export default async function ImportReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (isProductionDeployment()) notFound();
  const { id } = await params;
  return <PrototypeImportReview id={id} />;
}
