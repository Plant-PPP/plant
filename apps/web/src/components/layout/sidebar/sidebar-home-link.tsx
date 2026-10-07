"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/layout/brand-logo";
import { useSidebar } from "@/components/ui/sidebar";

export function SidebarHomeLink() {
  const { setOpenMobile } = useSidebar();
  return (
    <Link
      href="/"
      className="flex h-8 items-center px-2"
      onClick={() => setOpenMobile(false)}
    >
      <BrandLogo variant="logotype" className="h-6 w-auto" />
    </Link>
  );
}
