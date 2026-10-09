jest.mock("@/app/(app)/accounts/actions", () => ({}));

import { renderToStaticMarkup } from "react-dom/server";
import { listView } from "@/test/list-view";
import { AccountsSetup } from "./accounts-setup";

it("announces nothing while no write runs", () => {
  const html = renderToStaticMarkup(
    <AccountsSetup
      sourceConnections={listView()}
      portfolios={listView({ active: [{ id: "p1", name: "Principal" }] })}
      holders={listView()}
    />,
  );
  expect(html).toContain('<p role="status" class="sr-only"></p>');
  expect(html).toContain('title="Principal">Principal</span>');
});
