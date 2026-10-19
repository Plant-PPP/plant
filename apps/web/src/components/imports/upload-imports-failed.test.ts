const mockToast = { error: jest.fn(), success: jest.fn() };
const mockRefresh = jest.fn();
const mockTransitions: Promise<void>[] = [];

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useEffect: () => undefined,
  useTransition: () => [
    false,
    (run: () => Promise<void>) => mockTransitions.push(run()),
  ],
}));
jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  useRouter: () => ({ refresh: mockRefresh }),
}));
jest.mock("sonner", () => ({ toast: mockToast }));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => "client" }));

import type { ReactElement } from "react";

import type { ImportPage } from "./import-page";
import {
  UPLOAD_MESSAGES,
  type UploadActions,
  UploadImports,
} from "./upload-imports";

type PageProps = Parameters<typeof ImportPage>[0];

const page = (actions: UploadActions) =>
  (
    UploadImports({
      userId: "u1",
      accounts: [],
      archivedAccounts: [],
      imports: [],
      used: 0,
      termsAccepted: false,
      actions,
    }) as ReactElement<PageProps>
  ).props;

beforeEach(() => {
  mockTransitions.length = 0;
  jest.clearAllMocks();
});

it("tells which files failed when the server could not be reached, and goes on with the rest", async () => {
  const actions: UploadActions = {
    start: jest.fn().mockRejectedValue(new Error("network")),
    finish: jest.fn(),
    acceptTerms: jest.fn(),
    discard: jest.fn(),
  };
  page(actions).actions.upload(
    [new File(["a"], "uno.pdf"), new File(["b"], "dos.pdf")],
    "a1",
  );
  await expect(Promise.all(mockTransitions)).resolves.toBeDefined();
  expect(actions.start).toHaveBeenCalledTimes(2);
  expect(mockToast.error.mock.calls).toEqual([
    [`uno.pdf: ${UPLOAD_MESSAGES.failed}`],
    [`dos.pdf: ${UPLOAD_MESSAGES.failed}`],
  ]);
  expect(mockRefresh).toHaveBeenCalled();
});

it("reads an acceptance that could not reach the server as not saved", async () => {
  const actions: UploadActions = {
    start: jest.fn(),
    finish: jest.fn(),
    acceptTerms: jest.fn().mockRejectedValue(new Error("network")),
    discard: jest.fn(),
  };
  page(actions).consent!.accept();
  await expect(Promise.all(mockTransitions)).resolves.toBeDefined();
  expect(mockToast.error).toHaveBeenCalledWith(
    "No pudimos guardar tu aceptación. Probá de nuevo.",
  );
});
