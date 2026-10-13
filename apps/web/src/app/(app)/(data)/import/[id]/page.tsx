import type { Metadata } from "next";

import { ImportReviewView } from "@/app/(app)/(data)/import/review-view";
import { PrototypeImportReview } from "@/components/prototype/prototype-imports";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/import") };
export const dynamic = "force-dynamic";

// An import's review. Outside production it reviews made-up statements.
export default async function ImportReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isProductionDeployment()) return <PrototypeImportReview id={id} />;
  return <ImportReviewView id={id} />;
}
