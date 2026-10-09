# UI conventions

How Plant's screens look and behave. The theme (Salvia brand, tokens in `apps/web/src/app/globals.css`) and the shell (inset sidebar, breadcrumb header) stay as they are; this covers what goes inside a page. Copy is Spanish from Argentina with voseo.

## Feedback

- **The result of an action is a toast** (`toast` from `sonner`; the `Toaster` is mounted once in the root layout). Success uses `toast.success` in the past tense, short and without a final period: "Creaste Largo plazo", "Archivaste Principal". A failed action uses `toast.error` with the full sentence from the feature's messages ("No pudimos guardar. Probá de nuevo."). Extra detail goes in `description`.
- **What the user must fix stays on screen.** A field error inside a form is a `FormAlert` under the field, and the dialog stays open. State that outlives the action (a failed read, an empty list) is inline text, not a toast.
- After an action that removes the control that triggered it (a row that moves to another list), focus goes to the nearest heading so it does not fall to the page.

## Row actions

- **Icons, not words.** Up to two actions per row, each an `IconButton` (`components/ui/icon-button.tsx`): ghost, `size-7`, a 14px lucide icon, a tooltip with the action ("Archivar") and an accessible name with the row ("Archivar Principal").
- Three or more actions go in a `⋯` menu (`DropdownMenu`, `align="end"`), with any destructive item last after a separator.
- While an action runs, the row buttons are `aria-disabled`, never `disabled`, so focus stays on them.

## Forms and overlays

- **Every form opens in a centered `Dialog`**, never a `Sheet`. A long form scrolls inside the dialog. `ui/sheet.tsx` is only for the sidebar on mobile.
- The dialog has a title, a one-line description, the fields stacked as `Label` over `Input` (`grid gap-2`) and the primary button in the footer. While it saves, the button reads "Guardando…" and the dialog cannot be dismissed.
- On close, focus returns to the control that opened the dialog, or to the nearest heading when that control is gone.
- **Irreversible actions ask first**, in an `AlertDialog`: the title names the action, the description states the consequence, "Cancelar" comes first and the action button is `destructive`. Reversible actions (archive, restore) run without asking.

## Lists and amounts

- **Lists of records are a `DataTable`** (`components/ui/data-table.tsx`), one per list, named by a screen-reader caption ("Carteras", "Carteras archivadas"). Rows keep the server's order: a list is capped or paged by keyset, so sorting it in the browser would only reorder what is loaded.
- Row actions are an `actionsColumn` of `IconButton`s, sized to its buttons. Single-line text cuts with an ellipsis and carries the whole text in a `title` (`TruncatedText`), which shows on hover; screen readers get the whole text.
- Columns respond to the table's width, not the screen's: secondary columns use `hidden @2xl:table-cell`, and below that width their values ride inside the first column (on its first line or a muted second line), so nothing is lost on a narrow card.
- Amounts are right-aligned with `tabular-nums`, formatted `es-AR` with their currency (`$ 1.234.567,89`, `US$ 12.345,67`), and never pass through a `number` to be summed.

## Density and type

- Card title `text-lg`, body `text-sm`, secondary text `text-xs text-muted-foreground`.
- Default gap `gap-2`; between blocks `gap-4`.
- Buttons: `size="sm"` for card and dialog actions, `IconButton` for row actions.
