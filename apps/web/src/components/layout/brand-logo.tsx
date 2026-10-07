import Image from "next/image";
import logotype from "@/assets/brand/logotype.svg";
import logotypeDark from "@/assets/brand/logotype-dark.svg";
import mark from "@/assets/brand/mark.svg";
import markDark from "@/assets/brand/mark-dark.svg";
import { SITE_NAME } from "@/lib/site";
import { cn } from "@/lib/utils";

const VARIANTS = {
  logotype: { light: logotype, dark: logotypeDark },
  mark: { light: mark, dark: markDark },
};

export function BrandLogo({
  variant,
  className,
}: {
  variant: keyof typeof VARIANTS;
  className?: string;
}) {
  const { light, dark } = VARIANTS[variant];
  return (
    <>
      <Image
        src={light}
        alt={SITE_NAME}
        className={cn("dark:hidden", className)}
      />
      <Image
        src={dark}
        alt={SITE_NAME}
        className={cn("hidden dark:block", className)}
      />
    </>
  );
}
