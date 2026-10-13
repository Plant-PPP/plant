import Link from "next/link";

import { InstitutionIcon } from "@/components/portfolio-setup/institution-field";
import { TruncatedText } from "@/components/ui/data-table";
import { countOf } from "@/lib/format/text";

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

// The accounts an asset is held in: one by its icon and name, several by
// the first two icons and how many, each named for screen readers and on
// hover.
export function AccountsCell({
  accounts,
}: {
  accounts: readonly { id: string; institution: string }[];
}) {
  if (accounts.length === 1) {
    return <AccountCell institution={accounts[0]!.institution} />;
  }
  const names = accounts.map((each) => each.institution).join(", ");
  return (
    <span className="flex min-w-0 items-center gap-2" title={names}>
      <span aria-hidden className="flex shrink-0 -space-x-1">
        {accounts.slice(0, 2).map((each) => (
          <InstitutionIcon key={each.id} name={each.institution} />
        ))}
      </span>
      <span className="shrink-0" aria-hidden>
        {countOf(accounts.length, "cuenta", "cuentas")}
      </span>
      <span className="sr-only">{names}</span>
    </span>
  );
}

// The portfolios an asset is held in: one by name, several by how many, each
// named for screen readers and on hover.
export function PortfoliosCell({
  portfolios,
}: {
  portfolios: readonly { id: string; name: string }[];
}) {
  if (portfolios.length === 1) {
    return <TruncatedText text={portfolios[0]!.name} />;
  }
  const names = portfolios.map((each) => each.name).join(", ");
  return (
    <span title={names}>
      <span aria-hidden>
        {countOf(portfolios.length, "cartera", "carteras")}
      </span>
      <span className="sr-only">{names}</span>
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
