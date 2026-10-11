import type { Metadata } from "next";

import { PrototypeAssets } from "@/components/prototype/prototype-assets";

export const metadata: Metadata = {
  title: "Prototipo de Activos",
  robots: { index: false },
};

export default async function PrototypeAssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div>
      <h1 className="sr-only">Prototipo de Activos</h1>
      <PrototypeAssets params={await searchParams} />
    </div>
  );
}
