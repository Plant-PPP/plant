import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Switch } from "@/components/ui/switch";

import { ExcludedAccountsNote, ReportSwitch } from "./report-switch";

const render = (props: Partial<Parameters<typeof ReportSwitch>[0]> = {}) =>
  renderToStaticMarkup(
    <ReportSwitch id="f-tax" checked onCheckedChange={() => {}} {...props} />,
  );
const switchTag = (html: string) =>
  /<button[^>]*role="switch"[^>]*>/.exec(html)![0];

it("labels the switch and links its note to it", () => {
  const html = render({ note: <>La cuenta no se incluye.</> });
  expect(html).toContain("<label");
  expect(html).toMatch(/<label[^>]*for="f-tax"[^>]*>Incluir en el reporte</);
  expect(switchTag(html)).toContain('id="f-tax"');
  expect(switchTag(html)).toContain('aria-describedby="f-tax-note"');
  expect(html).toMatch(
    /<p id="f-tax-note"[^>]*>La cuenta no se incluye\.<\/p>/,
  );
});

it.each([
  ["false", false],
  ["undefined", undefined],
])("shows no note and describes nothing with a %s note", (_, note) => {
  const html = render({ note });
  expect(switchTag(html)).not.toContain("aria-describedby");
  expect(html).not.toContain("f-tax-note");
});

it("marks the switch aria-disabled only while a write runs, and keeps it focusable", () => {
  const pending = switchTag(render({ pending: true }));
  expect(pending).toContain('aria-disabled="true"');
  expect(pending).not.toMatch(/\sdisabled=""/);
  expect(switchTag(render())).not.toContain("aria-disabled");
  expect(switchTag(render({ checked: false }))).toContain(
    'aria-checked="false"',
  );
});

// The Switch element ReportSwitch returns, found in its element tree.
const switchIn = (
  node: ReactNode,
): ReactElement<{
  onCheckedChange: (on: boolean) => void;
}> | null => {
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === Switch) {
    return node as ReactElement<{ onCheckedChange: (on: boolean) => void }>;
  }
  const children = ([] as ReactNode[]).concat(node.props.children ?? []);
  for (const child of children) {
    const found = switchIn(child);
    if (found) return found;
  }
  return null;
};

it.each([
  [false, [[false]]],
  [true, []],
])(
  "passes a toggle on only when not pending (pending %s)",
  (pending, calls) => {
    const onCheckedChange = jest.fn();
    const tree = ReportSwitch({
      id: "f-tax",
      checked: true,
      onCheckedChange,
      pending,
    });
    switchIn(tree)!.props.onCheckedChange(false);
    expect(onCheckedChange.mock.calls).toEqual(calls);
  },
);

describe("the excluded-accounts note", () => {
  const note = (
    institutions: readonly string[],
    subject: "holding" | "asset",
  ) =>
    renderToStaticMarkup(
      <ExcludedAccountsNote institutions={institutions} subject={subject} />,
    );

  it("names the one account, linked to the accounts, and ends on the subject", () => {
    expect(note(["IOL"], "holding")).toBe(
      'La cuenta <a class="underline" href="/accounts">IOL</a> no se incluye en el reporte, así que esta tenencia tampoco.',
    );
  });

  it("links the accounts, unnamed, when there are two", () => {
    const html = note(["IOL", "Binance"], "asset");
    expect(html).toBe(
      'Las <a class="underline" href="/accounts">cuentas</a> donde lo tenés no se incluyen en el reporte, así que este activo tampoco.',
    );
    expect(html).not.toContain("IOL");
    expect(html).not.toContain("Binance");
  });

  it("agrees the pronoun with what is left out", () => {
    expect(note(["IOL", "Binance"], "holding")).toContain(
      "donde la tenés no se incluyen en el reporte, así que esta tenencia tampoco.",
    );
  });

  it("counts accounts, not names: two accounts of one institution read plural", () => {
    expect(note(["IOL", "IOL"], "asset")).toContain(
      '<a class="underline" href="/accounts">cuentas</a> donde lo tenés no se incluyen',
    );
  });

  it("describes the report switch it is the note of", () => {
    const html = render({
      note: <ExcludedAccountsNote institutions={["IOL"]} subject="holding" />,
    });
    expect(switchTag(html)).toContain('aria-describedby="f-tax-note"');
    expect(html).toContain(
      '<p id="f-tax-note" class="text-xs text-muted-foreground">La cuenta <a class="underline" href="/accounts">IOL</a> no se incluye en el reporte, así que esta tenencia tampoco.</p>',
    );
  });
});
