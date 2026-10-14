// Just enough XML for the reports providers send: the attributes of every
// element of a name, and the text of the first element of a name. Elements
// are matched by name only; no entity besides the five XML defines and
// numeric references is decoded, and nothing is ever fetched or expanded.

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decoded(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, name) => {
    if (name.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }
    return ENTITIES[name] ?? whole;
  });
}

const escaped = (name: string) => name.replace(/[^A-Za-z0-9_]/g, "");

// The attributes of each `<name …>` element, in document order.
export function elements(xml: string, name: string): Record<string, string>[] {
  const found: Record<string, string>[] = [];
  const tag = new RegExp(`<${escaped(name)}(\\s[^>]*?)?\\/?>`, "g");
  for (const match of xml.matchAll(tag)) {
    const attributes: Record<string, string> = {};
    for (const [, key, double, single] of (match[1] ?? "").matchAll(
      /([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    )) {
      attributes[key!] = decoded(double ?? single ?? "");
    }
    found.push(attributes);
  }
  return found;
}

// The text inside the first `<name>…</name>`, trimmed, or null.
export function textOf(xml: string, name: string): string | null {
  const match = new RegExp(
    `<${escaped(name)}(?:\\s[^>]*)?>([^<]*)</${escaped(name)}>`,
  ).exec(xml);
  return match ? decoded(match[1]!).trim() : null;
}
