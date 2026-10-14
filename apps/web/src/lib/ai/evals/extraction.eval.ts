// The extraction eval against the real models, over the test documents in
// evals/local-docs/, which never enter the repo. Not part of `pnpm test`;
// skipped without GOOGLE_GENERATIVE_AI_API_KEY or without documents.
//
//   pnpm --filter @plant/web eval:extraction

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import { fileUploadSource } from "@plant/sources";

jest.mock("server-only", () => ({}), { virtual: true });

import type { ColumnMappingsPort } from "@/lib/imports/column-mappings-store";
import {
  expectedReadingSchema,
  meetsTheBar,
  type ReadingScore,
  scoreReading,
} from "@/lib/imports/evals/score";
import { spreadsheetReader } from "@/lib/imports/spreadsheet-reader";

import { columnMapper } from "../column-mapper";
import { documentExtractor } from "../document-extractor";

const DOCS = join(__dirname, "../../../../../../evals/local-docs");

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".csv": "text/csv",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// Each document with its expected reading next to it.
const documents = existsSync(DOCS)
  ? readdirSync(DOCS).flatMap((name) => {
      const type = TYPES[extname(name).toLowerCase()];
      const expected = join(DOCS, `${name}.expected.json`);
      return type && existsSync(expected)
        ? [{ name, type, path: join(DOCS, name), expected }]
        : [];
    })
  : [];

// Mappings kept in memory for the run, so each spreadsheet maps its columns.
const mappings: ColumnMappingsPort = {
  get: async () => null,
  save: async () => {},
};

const source = fileUploadSource({
  document: documentExtractor({ record: async () => {} }),
  sheet: spreadsheetReader({
    mappings,
    mapColumns: columnMapper({ record: async () => {} }),
  }),
});

const run =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY && documents.length > 0
    ? describe
    : describe.skip;

run("extraction", () => {
  const scores: { name: string; score: ReadingScore; disputes: number }[] = [];

  it.each(documents)(
    "reads $name",
    async ({ name, type, path, expected }) => {
      const want = expectedReadingSchema.parse(
        JSON.parse(readFileSync(expected, "utf8")),
      );
      const reading = await source.read({
        importId: name,
        bytes: new Uint8Array(readFileSync(path)),
        mimeType: type,
        userId: "11111111-1111-4111-8111-111111111111",
        institution: name.split(/[-_.]/)[0] ?? "eval",
        lastAttempt: true,
      });
      // A document read as operations lists no holdings to score.
      const draft =
        "draft" in reading
          ? reading.draft
          : { documentDate: null, rows: [], totals: [] };
      scores.push({
        name,
        score: scoreReading(want, draft),
        disputes: reading.read.disputes,
      });
    },
    300_000,
  );

  afterAll(() => {
    // Names and counts only: the documents' figures stay out of the output.
    const lines = scores.map(
      ({ name, score, disputes }) =>
        `${name}: ${score.right} right, ${score.flagged} flagged, ` +
        `${score.wrong.length} wrong, ${score.extra.length} extra of ${score.rows} rows; ` +
        `totals ${score.totalsRight}/${score.totals}; ${disputes} disputes`,
    );
    const bar = meetsTheBar(scores.map(({ score }) => score));
    lines.push(
      `rows right or flagged: ${(bar.rowShare * 100).toFixed(1)}% · totals all right: ${bar.totalsAllRight}`,
    );
    process.stdout.write(`${lines.join("\n")}\n`);
    expect(bar.passes).toBe(true);
  });
});
