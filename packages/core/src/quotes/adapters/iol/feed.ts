import { buenosAiresDate, type Currency } from "@plant/shared";
import { z } from "zod";

import { exactUnitPrice, type InstrumentType } from "../../../instruments";
import type { GetJson, PostForm, RawQuoteFeed } from "../../contract/port";
import {
  parseResponse,
  type QuoteFeedCode,
  feedReadCode,
  QuoteFeedError,
  type RawPrice,
} from "../../contract/quote";

// Plant's own InvertirOnline account, passed by the composition root.
export type IolCredentials = { username: string; password: string };

export type IolDeps = {
  getJson: GetJson;
  postForm: PostForm;
  credentials: IolCredentials | null;
  // The catalog's instruments; the feed quotes the types IOL lists.
  instruments: () => Promise<
    readonly { symbol: string; type: InstrumentType; currency: Currency }[]
  >;
};

const BASE_URL = "https://api.invertironline.com";
const TOKEN_URL = `${BASE_URL}/token`;

// The panels each type is read from, each panel in one request.
export const PANELS = {
  cedear: ["cedears"],
  stock: ["acciones"],
  bond: ["titulosPublicos", "obligacionesNegociables", "letras"],
} as const satisfies Partial<Record<InstrumentType, readonly string[]>>;
type PanelType = keyof typeof PANELS;
type Panel = (typeof PANELS)[PanelType][number];

export const isIolType = (type: InstrumentType): type is PanelType =>
  Object.hasOwn(PANELS, type);

// A whole panel lists hundreds of lines, past the reader's default cap.
const PANEL_MAX_BYTES = 8 * 1024 * 1024;

export const panelUrl = (panel: string) =>
  `${BASE_URL}/api/v2/Cotizaciones/${panel}/argentina/Todos` +
  `?cotizacionInstrumentoModel.instrumento=${panel}` +
  `&cotizacionInstrumentoModel.pais=argentina`;

// A catalog instrument the feed quotes, in the currency the catalog keeps it
// in. A dollar instrument is read from its MEP line (the symbol with D).
export type IolInstrument = {
  symbol: string;
  type: PanelType;
  currency: Currency;
};

const lineSymbol = ({ symbol, currency }: IolInstrument) =>
  currency === "USD" ? `${symbol}D` : symbol;

export const MONEDA: Readonly<Record<string, Currency>> = {
  peso_Argentino: "ARS",
  dolar_Estadounidense: "USD",
};

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  ".refreshexpires": z.string().optional(),
});

const panelSchema = z.object({ titulos: z.array(z.unknown()) });

const lineSchema = z.object({
  simbolo: z.string(),
  ultimoPrecio: z.number(),
  fecha: z.string(),
  moneda: z.unknown().optional(),
});

// The bearer token lives 15 minutes; it is renewed a minute early.
const ACCESS_TTL_MS = 15 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;

type Session = {
  access: string;
  accessUntil: number;
  refresh: string | null;
  refreshUntil: number;
};

// IOL stamps Buenos Aires wall time, with no offset.
const LOCAL_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?$/;
const OFFSET_STAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})$/;

function stampOf(fecha: string): Date | null {
  const text = LOCAL_STAMP.test(fecha)
    ? `${fecha.replace(/(\.\d{3})\d+$/, "$1")}-03:00`
    : OFFSET_STAMP.test(fecha)
      ? fecha.replace(/(\.\d{3})\d+(?=Z|[+-])/, "$1")
      : null;
  if (text === null) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

// A price the schemas refuse, so the row counts as invalid.
const REFUSED = "";

const DECIMAL = /^\d+(\.\d+)?$/;

const simboloOf = (line: unknown): unknown =>
  typeof line === "object" && line !== null && Object.hasOwn(line, "simbolo")
    ? (line as { simbolo: unknown }).simbolo
    : undefined;

const listsLine = (titulos: readonly unknown[], instrument: IolInstrument) =>
  titulos.some((line) => simboloOf(line) === lineSymbol(instrument));

// The instrument's row from its line in a panel. A line missing, malformed,
// in the other currency or with no traded price gets a price the schemas
// refuse; a line dated another day is dated that day, and quoteWindow decides.
export function parseLine(
  instrument: IolInstrument,
  titulos: readonly unknown[],
  now: Date,
): RawPrice {
  const wanted = lineSymbol(instrument);
  const refused: RawPrice = {
    symbol: instrument.symbol,
    price_date: buenosAiresDate(now),
    price: REFUSED,
    currency: instrument.currency,
    quoted_at: now.toISOString(),
  };
  const raw = titulos.find((line) => simboloOf(line) === wanted);
  const line = lineSchema.safeParse(raw);
  if (!line.success) return refused;
  const { ultimoPrecio, fecha, moneda } = line.data;
  const stamp = stampOf(fecha);
  if (!stamp) return refused;
  const dated = {
    ...refused,
    price_date: buenosAiresDate(stamp),
    quoted_at: stamp.toISOString(),
  };
  // A moneda IOL sends must be one Plant knows and the instrument's; a dollar
  // line is priced only when IOL says it is in dollars.
  const currency =
    typeof moneda === "string" && Object.hasOwn(MONEDA, moneda)
      ? MONEDA[moneda]
      : undefined;
  if (moneda !== undefined && moneda !== null && currency === undefined) {
    return dated;
  }
  if (
    currency === undefined
      ? instrument.currency === "USD"
      : currency !== instrument.currency
  ) {
    return dated;
  }
  const quoted = String(ultimoPrecio);
  if (!(ultimoPrecio > 0) || !DECIMAL.test(quoted)) return dated;
  return {
    ...dated,
    price: exactUnitPrice(instrument.type, quoted) ?? REFUSED,
  };
}

type PanelRead =
  | { ok: true; panel: Panel; titulos: unknown[] }
  | { ok: false; panel: Panel; code: QuoteFeedCode };

export function createIolFeed(deps: IolDeps): RawQuoteFeed {
  let session: Session | null = null;

  async function grant(
    form: Record<string, string>,
    at: number,
  ): Promise<Session> {
    const token = parseResponse(
      tokenSchema,
      await deps.postForm(TOKEN_URL, form),
    );
    const refreshUntil = Date.parse(token[".refreshexpires"] ?? "");
    return {
      access: token.access_token,
      accessUntil:
        at + (token.expires_in ? token.expires_in * 1000 : ACCESS_TTL_MS),
      refresh: token.refresh_token ?? null,
      refreshUntil: Number.isNaN(refreshUntil) ? at : refreshUntil,
    };
  }

  // A cached token while it lives, else a refresh, else the password. A
  // refresh IOL refuses falls back to the password.
  async function tokenAt(
    at: number,
    credentials: IolCredentials,
  ): Promise<{ access: string; cached: boolean }> {
    if (session && at < session.accessUntil - EXPIRY_MARGIN_MS) {
      return { access: session.access, cached: true };
    }
    const previous = session;
    session = null;
    if (previous?.refresh && at < previous.refreshUntil - EXPIRY_MARGIN_MS) {
      try {
        session = await grant(
          { grant_type: "refresh_token", refresh_token: previous.refresh },
          at,
        );
      } catch (error) {
        const code = feedReadCode(error);
        if (code !== "http_4xx" && code !== "unauthorized") throw error;
      }
    }
    session ??= await grant(
      {
        grant_type: "password",
        username: credentials.username,
        password: credentials.password,
      },
      at,
    );
    return { access: session.access, cached: false };
  }

  async function readPanels(
    access: string,
    panels: readonly Panel[],
  ): Promise<PanelRead[]> {
    const headers = { Authorization: `Bearer ${access}` };
    return Promise.all(
      panels.map(async (panel): Promise<PanelRead> => {
        try {
          const json = await deps.getJson(panelUrl(panel), {
            headers,
            maxBytes: PANEL_MAX_BYTES,
          });
          return {
            ok: true,
            panel,
            titulos: parseResponse(panelSchema, json).titulos,
          };
        } catch (error) {
          const code = feedReadCode(error);
          if (code === null) throw error;
          return { ok: false, panel, code };
        }
      }),
    );
  }

  return {
    id: "iol",
    listed: true,
    async readRaw(now) {
      const { credentials } = deps;
      if (!credentials) throw new QuoteFeedError("unconfigured");
      const instruments = (await deps.instruments()).filter(
        (instrument): instrument is IolInstrument => isIolType(instrument.type),
      );
      if (instruments.length === 0) return { fxRates: [], prices: [] };
      const wanted = [
        ...new Set(instruments.flatMap(({ type }) => PANELS[type])),
      ];
      const at = now.getTime();
      const token = await tokenAt(at, credentials);
      let panels = await readPanels(token.access, wanted);
      // A cached token IOL refuses was revoked early: one more try with a
      // new one. Any other refusal fails its panel.
      if (
        token.cached &&
        panels.some((panel) => !panel.ok && panel.code === "unauthorized")
      ) {
        session = null;
        panels = await readPanels(
          (await tokenAt(at, credentials)).access,
          wanted,
        );
      }
      const byPanel = new Map(panels.map((read) => [read.panel, read]));
      const prices: RawPrice[] = [];
      const unread: { key: string; code: QuoteFeedCode }[] = [];
      for (const instrument of instruments) {
        const reads = PANELS[instrument.type].map(
          (panel) => byPanel.get(panel) as PanelRead,
        );
        // A type's line is in one of its panels: the first that lists it,
        // else unread when a panel that could list it failed.
        const titulos = reads.flatMap((read) => (read.ok ? read.titulos : []));
        const failed = reads.find((read) => !read.ok);
        if (failed && !failed.ok && !listsLine(titulos, instrument)) {
          unread.push({ key: instrument.symbol, code: failed.code });
        } else {
          prices.push(parseLine(instrument, titulos, now));
        }
      }
      return { fxRates: [], prices, unread };
    },
  };
}
