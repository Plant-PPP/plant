import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Pencil } from "lucide-react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DataTable,
  TruncatedText,
  actionsColumn,
  rowActionButton,
} from "./data-table";

type Row = { id: string; name: string; unsaved?: true };

const rows: Row[] = [
  { id: "a", name: "Principal" },
  { id: "b", name: "Largo plazo" },
];

const nameColumn: ColumnDef<Row> = {
  id: "name",
  header: "Nombre",
  cell: ({ row }) => row.original.name,
};

function render(columns: ColumnDef<Row>[], data: Row[] = rows) {
  return renderToStaticMarkup(
    <DataTable columns={columns} data={data} caption="Carteras" />,
  );
}

it("names the table with a caption only screen readers get", () => {
  expect(render([nameColumn])).toMatch(
    /<caption[^>]*class="[^"]*\bsr-only\b[^"]*">Carteras<\/caption>/,
  );
});

it("renders the rows in the order given", () => {
  const html = render([nameColumn], [{ id: "c", name: "Nueva" }, ...rows]);
  expect(html.indexOf("Nueva")).toBeLessThan(html.indexOf("Principal"));
  expect(html.indexOf("Principal")).toBeLessThan(html.indexOf("Largo plazo"));
});

it("sets a width only on sized columns", () => {
  const html = render([
    nameColumn,
    { id: "kind", header: "Tipo", size: 128, cell: () => "x" },
  ]);
  expect(html).toMatch(/<th[^>]*>Nombre<\/th>/);
  expect(html).not.toMatch(/<th[^>]*style[^>]*>Nombre<\/th>/);
  expect(html).toMatch(/<th[^>]*style="width:128px"[^>]*>Tipo<\/th>/);
});

it("puts a column's classes on its header and body cells", () => {
  const html = render([
    nameColumn,
    {
      id: "kind",
      header: "Tipo",
      cell: () => "x",
      meta: { className: "hidden @2xl:table-cell" },
    },
  ]);
  expect(html.match(/hidden @2xl:table-cell/g)).toHaveLength(3);
});

it("shows the whole text in the tooltip of a truncated line", () => {
  expect(
    renderToStaticMarkup(
      <TruncatedText text="Mediano plazo" className="text-xs" />,
    ),
  ).toBe(
    '<span class="block truncate text-xs" title="Mediano plazo">Mediano plazo</span>',
  );
});

it("renders a header given as a function", () => {
  const html = render([
    {
      id: "name",
      header: () => <span className="sr-only">Nombre</span>,
      cell: ({ row }) => row.original.name,
    },
  ]);
  expect(html).toMatch(/<th[^>]*><span class="sr-only">Nombre<\/span><\/th>/);
});

it("calls each cell with its context instead of mounting it", () => {
  const cell = jest.fn(({ row }: { row: { original: Row } }) => (
    <b>{row.original.name}</b>
  ));
  const html = render([{ id: "name", header: "Nombre", cell }]);
  expect(html).toContain("<b>Principal</b>");
  expect(cell).toHaveBeenCalledTimes(rows.length);
  // React calls a mounted component with a second argument; a direct call
  // passes only the cell's context.
  for (const call of cell.mock.calls) expect(call).toHaveLength(1);
});

it("fades an unsaved row and marks it busy", () => {
  const html = render(
    [nameColumn],
    [{ id: "n", name: "Nueva", unsaved: true }, rows[0]!],
  );
  expect(html).toContain(
    '<tr data-slot="table-row" class="border-b opacity-60" data-row-id="n" aria-busy="true">',
  );
  expect(html).toContain(
    '<tr data-slot="table-row" class="border-b" data-row-id="a">',
  );
});

describe("actionsColumn", () => {
  const actions = [
    {
      id: "rename",
      icon: Pencil,
      tooltip: "Renombrar",
      label: (row: Row) => `Renombrar ${row.name}`,
      onClick: () => {},
    },
    {
      id: "archive",
      icon: Archive,
      tooltip: "Archivar",
      label: (row: Row) => `Archivar ${row.name}`,
      onClick: () => {},
    },
  ];

  it("names each button after its row", () => {
    const html = render([
      nameColumn,
      actionsColumn(actions, { pending: false }),
    ]);
    for (const label of [
      "Renombrar Principal",
      "Archivar Principal",
      "Renombrar Largo plazo",
      "Archivar Largo plazo",
    ]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).not.toContain('aria-disabled="true"');
    expect(html.match(/data-action="rename"/g)).toHaveLength(2);
    expect(html.match(/data-action="archive"/g)).toHaveLength(2);
  });

  it("holds every button while an action runs", () => {
    const html = render([
      nameColumn,
      actionsColumn(actions, { pending: true }),
    ]);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(4);
  });

  it("hands each button's action the row it sits on", () => {
    const clicks = actions.map(() => jest.fn());
    const column = actionsColumn(
      actions.map((action, index) => ({ ...action, onClick: clicks[index]! })),
      { pending: false },
    );
    const cell = column.cell as (context: {
      row: { original: Row };
    }) => React.ReactElement<{
      children: React.ReactElement<{ onClick: () => void }>[];
    }>;
    for (const row of rows) {
      for (const button of cell({ row: { original: row } }).props.children) {
        button.props.onClick();
      }
    }
    for (const click of clicks) {
      expect(click.mock.calls).toEqual([[rows[0]], [rows[1]]]);
    }
  });

  it("is as wide as its buttons", () => {
    expect(actionsColumn(actions, { pending: false }).size).toBe(84);
    expect(actionsColumn(actions.slice(0, 1), { pending: false }).size).toBe(
      52,
    );
  });
});

describe("rowActionButton", () => {
  const button = {} as HTMLElement;

  function rootFinding(found: HTMLElement | null) {
    const querySelector = jest.fn<HTMLElement | null, [string]>(() => found);
    return { root: { querySelector } as unknown as ParentNode, querySelector };
  }

  beforeEach(() => {
    // Node has no CSS global; the stub marks what went through CSS.escape.
    globalThis.CSS = {
      escape: (value: string) => `<${value}>`,
    } as unknown as typeof CSS;
  });

  afterEach(() => {
    delete (globalThis as { CSS?: unknown }).CSS;
  });

  it("finds an action's button inside its row, both ids escaped", () => {
    const { root, querySelector } = rootFinding(button);
    expect(rowActionButton(root, 'a"b', "archive")).toBe(button);
    expect(querySelector.mock.calls).toEqual([
      ['tr[data-row-id="<a"b>"] [data-action="<archive>"]'],
    ]);
  });

  it("finds nothing when the row has no such button", () => {
    expect(rowActionButton(rootFinding(null).root, "a", "restore")).toBeNull();
  });
});
