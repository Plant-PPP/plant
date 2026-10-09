import type * as React from "react";

// radix-ui with the dialog rendered in place: renderToStaticMarkup has no
// document for its portal to reach. Use as
// jest.mock("radix-ui", () => jest.requireActual("@/test/inline-dialog-portal").radixWithInlinePortal()).
export function radixWithInlinePortal() {
  const actual = jest.requireActual("radix-ui");
  return {
    ...actual,
    Dialog: {
      ...actual.Dialog,
      Portal: ({ children }: { children: React.ReactNode }) => children,
    },
  };
}
