import Link from "next/link";

import { InstitutionIcon } from "@/components/portfolio-setup/institution-field";
import { TruncatedText } from "@/components/ui/data-table";

// The ticker beside an asset's name.
export function TickerChip({ ticker }: { ticker: string }) {
  return (
    <span className="bg-muted inline-block max-w-full truncate rounded px-1.5 py-0.5 font-mono text-xs">
      {ticker}
    </span>
  );
}

// An account by its institution's icon and name.
export function AccountCell({ institution }: { institution: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <InstitutionIcon name={institution} />
      <TruncatedText text={institution} />
    </span>
  );
}

// A name that opens its page when the page has one.
export function NameLink({
  text,
  href,
  className,
}: {
  text: string;
  href: string | null | undefined;
  className?: string;
}) {
  if (!href) return <TruncatedText text={text} className={className} />;
  return (
    <Link
      href={href}
      title={text}
      className={`block truncate underline-offset-2 hover:underline ${className ?? ""}`}
    >
      {text}
    </Link>
  );
}
