// What the debt event RPCs and guards raise when an event or a debt edit
// breaks one of a debt's rules (public.record_liability_event and its
// siblings, private.liability_guard, private.liability_event_guard and
// private.liability_history_guard in supabase/migrations): the SQLSTATE and the hints the app maps to its copy.
export const LIABILITY_EVENT_GUARD = {
  sqlstate: "PT409",
  hints: [
    "future_date",
    "has_history",
    "before_opening",
    "no_history",
    "no_cash_link",
    "settled",
  ],
} as const;

export type LiabilityEventGuardHint =
  (typeof LIABILITY_EVENT_GUARD.hints)[number];
