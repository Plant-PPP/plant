"use client";

import {
  DENOMINATORS,
  type Denominator,
  type ReferenceDollar,
  referenceUnit,
} from "@plant/core";
import { useId } from "react";
import { toast } from "sonner";

import { choose } from "@/components/portfolio-setup/field-alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UNIT_LABELS } from "@/lib/holdings/messages";

export type Preferences = {
  referenceDollar: ReferenceDollar;
  // The unit the pages open in; null for the reference dollar's.
  preferredUnit: Denominator | null;
};

const REFERENCE_DOLLARS: readonly ReferenceDollar[] = ["mep", "ccl"];

// The preferred unit's value for "the reference dollar's".
const REFERENCE = "reference";

// How the user's money is shown: the dollar the app values in by default,
// and the unit Resumen, Activos and Deudas open in. A link's ?unit= wins.
export function PreferencesCard({
  preferences,
  onChange,
}: {
  preferences: Preferences;
  onChange: (next: Preferences) => Promise<{ ok: boolean }>;
}) {
  const id = useId();
  const save = (next: Preferences) =>
    void onChange(next).then((result) =>
      result.ok
        ? toast.success("Guardamos tus preferencias.")
        : toast.error("No pudimos guardar. Probá de nuevo."),
    );
  const reference = UNIT_LABELS[referenceUnit(preferences.referenceDollar)];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cómo ves tu plata</CardTitle>
        <CardDescription>
          Un link que trae otra unidad la usa igual.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-dollar`}>Dólar de referencia</Label>
          <Select
            value={preferences.referenceDollar}
            onValueChange={choose((value) =>
              save({
                ...preferences,
                referenceDollar: value as ReferenceDollar,
              }),
            )}
          >
            <SelectTrigger id={`${id}-dollar`} className="w-full">
              <SelectValue>
                {UNIT_LABELS[referenceUnit(preferences.referenceDollar)]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REFERENCE_DOLLARS.map((each) => (
                <SelectItem key={each} value={each}>
                  {UNIT_LABELS[referenceUnit(each)]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-unit`}>Las pantallas abren en</Label>
          <Select
            value={preferences.preferredUnit ?? REFERENCE}
            onValueChange={choose((value) =>
              save({
                ...preferences,
                preferredUnit:
                  value === REFERENCE ? null : (value as Denominator),
              }),
            )}
          >
            <SelectTrigger id={`${id}-unit`} className="w-full">
              <SelectValue>
                {preferences.preferredUnit === null
                  ? `Tu dólar de referencia (${reference})`
                  : UNIT_LABELS[preferences.preferredUnit]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={REFERENCE}>
                {`Tu dólar de referencia (${reference})`}
              </SelectItem>
              {(Object.keys(DENOMINATORS) as Denominator[]).map((each) => (
                <SelectItem key={each} value={each}>
                  {UNIT_LABELS[each]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
