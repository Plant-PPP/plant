const mockToast = {
  error: jest.fn(),
  success: jest.fn(),
  warning: jest.fn(),
};
const mockTransitions: Promise<void>[] = [];
const mockPin = jest.fn();
const mockLoadConversation = jest.fn();
const mockDeleteConversation = jest.fn();
const mockRethrown: unknown[] = [];

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useState: (initial: unknown) => [
    typeof initial === "function" ? (initial as () => unknown)() : initial,
    () => undefined,
  ],
  useRef: (current: unknown) => ({ current }),
  useMemo: (make: () => unknown) => make(),
  useId: () => "id",
  useOptimistic: (state: unknown) => [state, () => undefined],
  useTransition: () => [
    false,
    (run: () => Promise<void>) => mockTransitions.push(run()),
  ],
}));
jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  useRouter: () => ({ refresh() {} }),
}));
// What settle rethrows is recorded, and the call then waits as it does while
// Next navigates away.
jest.mock("@/lib/server-action-call", () => {
  const { settle } = jest.requireActual("@/lib/server-action-call");
  return {
    settle: (call: Promise<unknown>) =>
      settle(call).catch((error: unknown) => {
        mockRethrown.push(error);
        return new Promise(() => undefined);
      }),
  };
});
jest.mock("sonner", () => ({ toast: mockToast }));
jest.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: jest.fn(),
    setMessages: jest.fn(),
    status: "ready",
    stop: jest.fn(),
  }),
}));
jest.mock("@/lib/ai/assistant/transport", () => ({
  chatTransport: () => ({}),
}));
jest.mock("@/app/(app)/(data)/assistant/actions", () => ({
  loadConversation: (...args: unknown[]) => mockLoadConversation(...args),
  deleteConversation: (...args: unknown[]) => mockDeleteConversation(...args),
}));
jest.mock("@/components/assistant/pin-context", () => ({
  usePin: () => ({ pin: mockPin, pins: () => true }),
}));

import type { ReactNode } from "react";

import { AssistantChat } from "@/components/assistant/assistant-chat";
import { ChartCard } from "@/components/assistant/chart-card";
import { suggestionAnswer } from "@/components/holdings/movement-dialog";
import { readSiteIcon } from "@/components/portfolio-setup/source-connection-dialog";
import { AlertsCard } from "@/components/settings/alerts-card";
import { ExportCard } from "@/components/settings/export-card";
import { MetAlerts } from "@/components/summary/met-alerts";
import { PinnedCharts } from "@/components/summary/pinned-charts";
import { barsOf } from "@/lib/assistant/chat";
import type { PriceAlert } from "@/lib/alerts/alerts";
import { findProps } from "@/test/element-tree";

const { redirect } =
  jest.requireActual<typeof import("next/navigation")>("next/navigation");

function redirectError(): unknown {
  try {
    redirect("/login");
  } catch (error) {
    return error;
  }
  throw new Error("redirect did not throw");
}

const alert: PriceAlert = {
  id: "a1",
  subjectKind: "dollar",
  subject: "mep",
  direction: "above",
  threshold: "1500",
  currency: "ARS",
  gainPercent: null,
  costPrice: null,
  metOn: "2026-10-14",
  metPrice: "1510",
  seenAt: null,
};
const chart = barsOf("bars", "Por moneda", "ars", [
  { label: "ARS", value: "100" },
]);

beforeEach(() => {
  mockTransitions.length = 0;
  mockRethrown.length = 0;
  jest.clearAllMocks();
});

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const click = (tree: ReactNode, label: string) => {
  const props = findProps(
    tree,
    (each) =>
      typeof each.onClick === "function" &&
      (String(each["aria-label"] ?? "").startsWith(label) ||
        [each.children].flat().includes(label)),
  );
  if (!props) throw new Error(`no button ${label}`);
  (props.onClick as () => void)();
};

// Each user action, given how its server action rejects.
const sites: {
  name: string;
  act: (reject: () => Promise<never>) => void;
  failure: string;
}[] = [
  {
    name: "creating an alert",
    act: (reject) => {
      const tree = AlertsCard({
        alerts: [],
        instruments: [],
        onCreate: reject,
        onDelete: async () => true,
      });
      const form = findProps(tree, (each) => "onCreate" in each)!;
      void (form.onCreate as (a: unknown, p: PriceAlert) => Promise<boolean>)(
        {},
        alert,
      );
    },
    failure: "No pudimos crear la alerta. Probá de nuevo.",
  },
  {
    name: "deleting an alert",
    act: (reject) =>
      click(
        AlertsCard({
          alerts: [alert],
          instruments: [],
          onCreate: async () => "ok",
          onDelete: reject,
        }),
        "Borrar la alerta",
      ),
    failure: "No pudimos borrar la alerta. Probá de nuevo.",
  },
  {
    name: "marking a met alert seen",
    act: (reject) =>
      click(MetAlerts({ alerts: [alert], onSeen: reject }), "Listo"),
    failure: "No pudimos marcar el aviso. Probá de nuevo.",
  },
  {
    name: "unpinning a chart",
    act: (reject) =>
      click(
        PinnedCharts({
          pinned: [{ id: "c1", chart, asOf: "2026-10-14" }],
          onUnpin: reject,
        }),
        "Soltar",
      ),
    failure: "No pudimos soltar el gráfico. Probá de nuevo.",
  },
  {
    name: "pinning a chart",
    act: (reject) => {
      mockPin.mockImplementation(reject);
      click(ChartCard({ chart, asOf: "2026-10-14" }), "Fijar en el Resumen");
    },
    failure: "No pudimos fijar el gráfico. Probá de nuevo.",
  },
  {
    name: "exporting",
    act: (reject) => click(ExportCard({ load: reject }), "Todo en Excel"),
    failure: "No pudimos armar el archivo. Probá de nuevo.",
  },
  {
    name: "opening a conversation",
    act: (reject) => {
      mockLoadConversation.mockImplementation(reject);
      const tree = AssistantChat({
        conversations: [],
        used: 0,
        defaultUnit: "usd_mep",
      });
      (
        findProps(tree, (each) => "onOpen" in each)!.onOpen as (
          id: string,
        ) => void
      )("c1");
    },
    failure: "No pudimos abrir la conversación. Probá de nuevo.",
  },
  {
    name: "deleting a conversation",
    act: (reject) => {
      mockDeleteConversation.mockImplementation(reject);
      const tree = AssistantChat({
        conversations: [],
        used: 0,
        defaultUnit: "usd_mep",
      });
      (
        findProps(tree, (each) => "onDelete" in each)!.onDelete as (
          id: string,
        ) => void
      )("c1");
    },
    failure: "No pudimos borrar la conversación. Probá de nuevo.",
  },
];

// Calls a dialog answers itself, not with a toast, given how they reject.
const answers: {
  name: string;
  call: (reject: () => Promise<never>) => Promise<unknown>;
  failed: unknown;
}[] = [
  {
    name: "reading an institution's icon",
    call: (reject) => readSiteIcon(reject, "https://www.banco.com.ar"),
    failed: { ok: false, reason: "failed" },
  },
  {
    name: "suggesting a movement's price",
    call: (reject) => suggestionAnswer(reject()),
    failed: null,
  },
];

describe.each(answers)("$name", ({ call, failed }) => {
  it("answers a call that failed as the failure", async () => {
    await expect(
      call(() => Promise.reject(new Error("offline"))),
    ).resolves.toEqual(failed);
  });

  it("lets the redirect of an ended session through", async () => {
    const error = redirectError();
    void call(() => Promise.reject(error));
    await settled();
    expect(mockRethrown).toEqual([error]);
  });
});

describe.each(sites)("$name", ({ act, failure }) => {
  it("tells a call that failed as the failure", async () => {
    act(() => Promise.reject(new Error("offline")));
    await settled();
    expect(mockToast.error).toHaveBeenCalledWith(failure);
  });

  it("lets the redirect of an ended session through", async () => {
    const error = redirectError();
    act(() => Promise.reject(error));
    await settled();
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockRethrown).toEqual([error]);
  });
});
