import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Switch } from "@/components/ui/switch";

import { ReportSwitch } from "./report-switch";

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
