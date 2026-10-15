# UI conventions

How Plant's screens look and behave. The theme (Salvia brand, tokens in `apps/web/src/app/globals.css`) and the shell (inset sidebar, breadcrumb header) stay as they are; this covers what goes inside a page. Copy is Spanish from Argentina with voseo.

Every screen is built from the same pieces in `apps/web/src/components/ui`, so two pages that show the same kind of thing look the same. A screen that needs something these pieces do not cover adds it here first.

## Scale

- Dense by default: body and table text `text-xs`, helper text `text-xs text-muted-foreground`, section headings `text-sm font-semibold`, empty-state titles `text-lg`.
- Page controls (buttons, selects, tabs in a toolbar) are 28px: `PageButton`, `FilterSelect`/`UnitSelect` (`size="xs"` triggers), `Segmented`, all `text-xs` with 14px icons.
- Dialog buttons are 32px (`h-8 text-xs`), row actions 28px (`IconButton`).
- Gaps: `gap-2` inside a block, `gap-4` between blocks, `gap-8` between sections.
- Amounts are right-aligned with `tabular-nums`, formatted `es-AR` with their currency (`$ 1.234.567,89`, `US$ 12.345,67`) by `formatAmount` (`lib/format/amount.ts`), and never pass through a `number` to be summed.
- Links have no underline and no hover effect; a name that opens its own page is a `NameLink`.

## Page

- **No visible title.** The header's breadcrumb names the page; the page keeps an `sr-only` `h1`. A detail page names itself with `PageCrumbs` (`components/layout/page-crumbs.tsx`): `Activos › Bitcoin`, `Cuentas › IOL`, `Cargar › resumen.pdf`. The parent crumb is the way back, so pages have no back links.
- **The first row is the toolbar** (`PageHeader`): filters on the left, actions on the right. It renders nothing visible when it has neither, so the content starts at the top. Page actions are outline `PageButton`s with at most one primary; anything else goes behind an icon (`IconButton size="toolbar"`) or a `⋯` menu.
- A page whose only content is one list (Activos, Deudas) puts the list's add button in that toolbar (`SetupCard page`); a page with several lists (Cuentas) keeps each list's heading and button on its own row.
- **Sections are flat** (`Section`): a small heading with an optional icon, a one-line description, its actions on the same row, and the content below bringing its own surface (a table, a chart). A card is used only for an object in itself (a pinned chart, a settings group).
- **Figures** are `StatTile`s in a `StatGrid`: a bordered tile with a muted label, the figure `text-2xl`, and a note that wraps. A row's figures line up whether or not their tiles carry a note.
- A switch between views of the same data (Cartera · Cuenta · Moneda, the years) is a `Segmented` tablist. A view switch that narrows the data is kept in the URL; one that only picks among tables already on screen stays in the page, and printing shows every view.

## Empty pages and lists

- Nothing to show yet is an `EmptyState`: an icon in a muted square, a short title without a final period, one or two sentences on what goes there and how it gets there, and an action only when it is not already in the toolbar (Resumen's "Cargar un resumen", Activos' "Agregar una cuenta" before any account exists).
- An empty page shows only the toolbar's actions and the empty state: no zeroed tiles, empty tables, unit selects or print buttons.
- A filter that matches nothing, or a table with no rows inside a page that has data, is a short centred `text-xs` line instead.

## Feedback

- **The result of an action is a toast** (`toast` from `sonner`; the `Toaster` is mounted once in the root layout). Success uses `toast.success` in the past tense, short and without a final period: "Creaste Largo plazo", "Archivaste Principal". A failure uses `toast.error` with the full sentence ("No pudimos guardar. Probá de nuevo."). Extra detail goes in `description`.
- **What the user must fix in a form is a toast too.** `FormAlert` raises it once per message and keeps the text hidden beside the field (`aria-describedby`), and the field keeps `aria-invalid`. The dialog stays open, or opens again, with what the user typed.
- **State that outlives an action is a `Notice`**: a quiet panel (`border-primary/15 bg-muted/40`) whose edges glow faintly in the variant's colour, with the variant's icon, an optional title, the text and an optional action. Variants: `info`, `warning` (data left out, an estimate), `error` (a read that failed; announced as an alert), `success`. Text keeps the foreground colour, so contrast does not depend on the variant.
- Status beside a name is a `Badge` (`neutral`, `info`, `warning`, `success`, `error`); status in a table row is a coloured icon and its label.
- After an action that removes the control that triggered it (a row that moves to another list), focus goes to the nearest heading so it does not fall to the page.
- **Every list action is optimistic.** The list changes when the user acts; the unsaved row is faded and `aria-busy`, and a polite status line reads "Guardando…". A refused row action puts the list back with the action's toast, and focus returns to the row's button.

## Forms and dialogs

- **Every form opens in a centered `AppDialog`**, never a `Sheet` (`ui/sheet.tsx` is only for the sidebar on mobile). The title carries an optional icon and a one-line description; labels and fields are `text-xs` from `md` (phones keep 16px inputs so iOS does not zoom).
- **Only what the form needs is on view.** Optional fields go in a `MoreFields` disclosure named by what it holds ("Con quién, cuota, tasa y vencimientos"), open from the start when any of them has a value. Labels never say "(opcional)". An explanation goes behind an info icon with a tooltip beside its label.
- Fields stack as `Label` over the control (`grid gap-2`), two per row (`grid grid-cols-2 gap-4`).
- **A form sends only when complete.** The browser's validation bubbles are off and the submit button stays disabled until every required field is filled (`useSubmitWhenValid`, wired into `AppDialog`).
- The footer is `DialogActions`: "Cancelar" (outline, closes) and the primary button, marked with `↵` because Enter in a field sends the form. A further action (a ghost destructive one on an edit) goes before them.
- A dialog that changes a list closes on submit and opens again with the fields and the toast when the write is refused. On close, focus returns to the control that opened it, or to the nearest heading when that control is gone.
- **Irreversible actions ask first**, in a `ConfirmDialog`: the title names the action as a question, the description states the consequence, "Cancelar" comes first and takes focus (so Enter never confirms by itself), and the action button is `destructive`. Reversible actions (archive, restore) run without asking.

## Lists and tables

- **Lists of records are a `DataTable`** (`components/ui/data-table.tsx`), one per list, named by a screen-reader caption. The frame is a `rounded-lg` hairline border; the header row sits on `bg-muted/50`; rows highlight on hover.
- Rows keep the server's order: a list is capped or paged by keyset, so sorting it in the browser would only reorder what is loaded. The exception is an order by a value the page computes after the read, such as a valuation: the browser sorts what is loaded, and the screen says when the list was cut.
- A table shows its column names only when several columns sit side by side; a one-column list, or any table below `@2xl`, keeps its header row out of view (`visibility: collapse`). Screen readers then read no column names, and the caption names the table.
- Columns respond to the table's width, not the screen's: secondary columns use `hidden @2xl:table-cell`, and below that width their values ride inside the first column, so nothing is lost on a narrow table.
- A `footer` row closes a table with its total. A sum shown while a write runs is dimmed (`opacity-60`, `aria-busy`), a row the server has not valued yet reads "Calculando…", and a sum of nothing reads "—".
- **Row actions are icons**: up to two `IconButton`s (ghost, `size-7`, a 14px icon, a tooltip with the action and an accessible name with the row); three or more go in a `⋯` menu (`DropdownMenu`, `align="end"`) with any destructive item last after a separator. While an action runs, the row buttons are `aria-disabled`, never `disabled`.
- **A row whose detail has its own page links to it** instead of opening under itself: Tenencias shows an instrument once and its name opens the instrument's page.
- An account shows its institution's icon beside its name (`InstitutionIcon`).
- A filter is a compact `FilterSelect` (a hidden label, the choice in the trigger), kept in the URL when it narrows a page's data. The unit a page values in is `UnitSelect`.

## Keyboard

- Enter sends a dialog's form; the primary button shows `↵`.
- ⌘K (Ctrl+K) opens the assistant's question field; the composer shows the hint.
- ⌘B toggles the sidebar.

## Prototype

Outside production the data pages carry a dashed note, "Datos de prueba. Lo que cambies se pierde al recargar."
