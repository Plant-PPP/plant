import Link from "next/link";
import { BrandLogo } from "@/components/layout/brand-logo";

export function AppSidebarLogoLink() {
  return (
    <Link href="/" className="group">
      <BrandLogo
        variant="mark"
        className="size-6 transition-transform duration-500 ease-in-out group-hover:rotate-120"
      />
    </Link>
  );
}
