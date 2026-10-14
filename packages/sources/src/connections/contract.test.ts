import {
  draftOperationSchema,
  importDraftSchema,
  SourceError,
} from "../file-upload/draft";
import {
  CONNECTION_PROVIDERS,
  type ConnectionProvider,
  connectionAdapters,
} from "./adapters";
import {
  type FakeProvider,
  startFakeProvider,
} from "./fake-provider.test-support";
import { NOW, PROVIDER_FIXTURES } from "./fixtures.test-support";
import { CONNECTION_DRAFTS } from "./port";

// The battery every adapter passes against its faked provider. A new
// provider joins it by its fixture.

let fake: FakeProvider;
beforeAll(async () => {
  fake = await startFakeProvider();
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.requests = [];
});

const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SourceError);
  const { code, retryable, message } = error as SourceError;
  return { code, retryable, message };
};

it("every provider has a fixture and an adapter", () => {
  expect(Object.keys(PROVIDER_FIXTURES).sort()).toEqual(
    [...CONNECTION_PROVIDERS].sort(),
  );
  const adapters = connectionAdapters();
  for (const provider of CONNECTION_PROVIDERS) {
    expect(adapters[provider]().provider).toBe(provider);
  }
});

describe.each(CONNECTION_PROVIDERS)("the %s adapter", (name) => {
  const provider = name as ConnectionProvider;
  const fixture = PROVIDER_FIXTURES[provider];
  const adapter = () =>
    fixture.make({ baseUrl: fake.url, now: () => NOW, timeoutMs: 2000 });
  const secrets = () =>
    adapter()
      .fields.filter((field) => field.secret)
      .map((field) => fixture.credentials[field.name]!);

  it("names its fields as its schema takes them, and a hint among them", () => {
    const port = adapter();
    expect(port.parse(fixture.credentials)).toEqual(fixture.credentials);
    expect(port.fields.map((field) => field.name).sort()).toEqual(
      Object.keys(fixture.credentials).sort(),
    );
    expect(port.fields.some((field) => field.secret)).toBe(true);
    // A secret is a hint only when it is the only field (a single API key):
    // the page shows its last four characters, never more.
    const hint = port.fields.find((field) => field.name === port.hintField);
    expect(hint).toBeDefined();
    if (port.fields.length > 1) expect(hint?.secret).toBe(false);
  });

  it("refuses credentials that do not parse without asking the provider", async () => {
    for (const raw of [{}, null, { ...fixture.credentials, extra: "x" }]) {
      expect(adapter().parse(raw)).toBeNull();
      expect(await failure(adapter().check(raw))).toMatchObject({
        code: "connection_rejected",
        retryable: false,
      });
    }
    expect(fake.requests).toEqual([]);
  });

  it("takes credentials that work", async () => {
    fake.answer = fixture.ok;
    await expect(adapter().check(fixture.credentials)).resolves.toBeUndefined();
  });

  it("refuses credentials the provider refuses, for good", async () => {
    fake.answer = fixture.refuse;
    expect(await failure(adapter().check(fixture.credentials))).toMatchObject({
      code: "connection_rejected",
      retryable: false,
    });
  });

  it("fails for a later attempt when the provider is down", async () => {
    fake.answer = () => ({ status: 503, body: {} });
    expect(await failure(adapter().check(fixture.credentials))).toMatchObject({
      code: "extraction_failed",
      retryable: true,
    });
  });

  it("fails for a later attempt when the provider cannot be reached", async () => {
    const down = fixture.make({
      baseUrl: "http://127.0.0.1:1",
      now: () => NOW,
      timeoutMs: 2000,
    });
    expect(await failure(down.check(fixture.credentials))).toMatchObject({
      code: "extraction_failed",
      retryable: true,
    });
  });

  it.each(CONNECTION_DRAFTS)(
    "reads %s as the draft a file yields, or refuses a draft it does not read",
    async (draft) => {
      fake.answer = fixture.ok;
      const port = adapter();
      if (!port.drafts.includes(draft)) {
        expect(
          await failure(port.read(fixture.credentials, draft)),
        ).toMatchObject({ code: "unsupported", retryable: false });
        return;
      }
      const reading = await port.read(fixture.credentials, draft);
      expect(reading.read.reader).toBe("api");
      if (draft === "holdings") {
        expect("draft" in reading).toBe(true);
        const parsed = importDraftSchema.parse(
          (reading as { draft: unknown }).draft,
        );
        expect(parsed.rows.length).toBeGreaterThan(0);
      } else {
        expect("operations" in reading).toBe(true);
        const operations = (reading as { operations: unknown[] }).operations;
        expect(operations.length).toBeGreaterThan(0);
        for (const each of operations) draftOperationSchema.parse(each);
      }
    },
  );

  it("only reads: GETs, and a POST only to the login it declares", async () => {
    fake.answer = fixture.ok;
    const port = adapter();
    for (const draft of port.drafts) {
      await port.read(fixture.credentials, draft);
    }
    expect(fake.requests.length).toBeGreaterThan(0);
    for (const request of fake.requests) {
      if (request.method === "GET") continue;
      expect(request.method).toBe("POST");
      expect(fixture.posts ?? []).toContain(request.path);
    }
  });

  it("keeps the secrets out of URLs and errors", async () => {
    fake.answer = fixture.ok;
    const port = adapter();
    for (const draft of port.drafts) {
      await port.read(fixture.credentials, draft);
    }
    if (!fixture.secretsInUrl) {
      for (const request of fake.requests) {
        for (const secret of secrets()) {
          expect(decodeURIComponent(request.url)).not.toContain(secret);
        }
      }
    }
    fake.answer = fixture.refuse;
    const { message } = await failure(port.check(fixture.credentials));
    for (const secret of secrets()) expect(message).not.toContain(secret);
  });
});
