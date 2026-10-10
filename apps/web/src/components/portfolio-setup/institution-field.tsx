"use client";

import Image, { type StaticImageData } from "next/image";
import { useRef } from "react";
import type * as React from "react";
import Allaria from "@/assets/institutions/allaria.png";
import Balanz from "@/assets/institutions/balanz.png";
import BancoGalicia from "@/assets/institutions/banco-galicia.png";
import BancoMacro from "@/assets/institutions/banco-macro.png";
import BancoNacion from "@/assets/institutions/banco-nacion.png";
import BancoSantander from "@/assets/institutions/banco-santander.png";
import Bbva from "@/assets/institutions/bbva.png";
import Binance from "@/assets/institutions/binance.png";
import Brubank from "@/assets/institutions/brubank.png";
import BullMarket from "@/assets/institutions/bull-market.png";
import Cocos from "@/assets/institutions/cocos.png";
import Ieb from "@/assets/institutions/ieb.png";
import Iol from "@/assets/institutions/iol.png";
import Lemon from "@/assets/institutions/lemon.png";
import MercadoPago from "@/assets/institutions/mercado-pago.png";
import NaranjaX from "@/assets/institutions/naranja-x.png";
import Ppi from "@/assets/institutions/ppi.png";
import Uala from "@/assets/institutions/uala.png";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// The suggested institutions and their icons: each one's favicon, saved once
// from its official site and served by Plant, so no outside service sees which
// institutions a user picks.
const ICONS = {
  Allaria,
  Balanz,
  "Banco Galicia": BancoGalicia,
  "Banco Macro": BancoMacro,
  "Banco Nación": BancoNacion,
  "Banco Santander": BancoSantander,
  BBVA: Bbva,
  Binance,
  Brubank,
  "Bull Market": BullMarket,
  Cocos,
  IEB: Ieb,
  IOL: Iol,
  Lemon,
  "Mercado Pago": MercadoPago,
  "Naranja X": NaranjaX,
  PPI: Ppi,
  Ualá: Uala,
} satisfies Record<string, StaticImageData>;

type Institution = keyof typeof ICONS;

export const INSTITUTIONS = Object.keys(ICONS) as Institution[];

const isInstitution = (name: string): name is Institution =>
  Object.hasOwn(ICONS, name);

// The last choice, which opens a field for a name the list does not have.
export const OTHER_INSTITUTION = "other";

// The select's starting choice for a saved name: none for a new account, the
// name if listed, else OTHER_INSTITUTION.
export function institutionChoice(name: string): string {
  if (name === "") return "";
  return isInstitution(name) ? name : OTHER_INSTITUTION;
}

// What the "Otra" field starts with for a saved name.
export function typedInstitution(name: string): string {
  return institutionChoice(name) === OTHER_INSTITUTION ? name : "";
}

// The institution an account is saved with: a listed one, or the name typed
// under "Otra".
export function chosenInstitution(choice: string, typed: string): string {
  return choice === OTHER_INSTITUTION ? typed : choice;
}

export function InstitutionField({
  id,
  choice,
  onChoose,
  initialOther,
  triggerRef,
  otherRef,
  onOtherChange,
  invalid,
  describedBy,
  autoFocus,
}: {
  id: string;
  choice: string;
  onChoose: (choice: string) => void;
  initialOther: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  otherRef: React.RefObject<HTMLInputElement | null>;
  onOtherChange: () => void;
  invalid: true | undefined;
  describedBy: string | undefined;
  autoFocus: boolean;
}) {
  const other = choice === OTHER_INSTITUTION;
  // Set by a pick of "Otra" from the open list, so its close moves focus to the
  // name field; opening the list clears it, so Escape never does.
  const pickedOther = useRef(false);
  return (
    <>
      <Select
        value={choice}
        onOpenChange={(open) => {
          if (open) pickedOther.current = false;
        }}
        onValueChange={(value) => {
          pickedOther.current = value === OTHER_INSTITUTION;
          onChoose(value);
        }}
      >
        <SelectTrigger
          ref={triggerRef}
          id={id}
          className="w-full"
          aria-invalid={other ? undefined : invalid}
          aria-describedby={other ? undefined : describedBy}
          autoFocus={autoFocus && !other}
        >
          <SelectValue placeholder="Elegí una institución" />
        </SelectTrigger>
        <SelectContent
          // Radix returns focus to the trigger on close; picking "Otra" when it
          // was not the choice sends it to the name field instead.
          onCloseAutoFocus={(event) => {
            if (!pickedOther.current) return;
            pickedOther.current = false;
            event.preventDefault();
            otherRef.current?.focus();
          }}
        >
          {INSTITUTIONS.map((name) => (
            <SelectItem key={name} value={name}>
              <InstitutionIcon name={name} />
              {name}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={OTHER_INSTITUTION}>Otra</SelectItem>
        </SelectContent>
      </Select>
      {/* Kept mounted, so a name typed under "Otra" survives a look at the
          list. */}
      <Input
        ref={otherRef}
        hidden={!other}
        aria-label="Nombre de la institución"
        placeholder="Nombre de la institución"
        defaultValue={initialOther}
        onChange={onOtherChange}
        aria-invalid={other ? invalid : undefined}
        aria-describedby={other ? describedBy : undefined}
        autoComplete="off"
        autoFocus={autoFocus && other}
      />
    </>
  );
}

// A listed institution's icon, or its initial for any other name.
export function InstitutionIcon({ name }: { name: string }) {
  if (isInstitution(name)) {
    return (
      <Image
        src={ICONS[name]}
        alt=""
        width={16}
        height={16}
        className="size-4 shrink-0 rounded-sm object-contain"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="bg-muted text-muted-foreground flex size-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-medium"
    >
      {name.trim().charAt(0).toLocaleUpperCase("es-AR")}
    </span>
  );
}
