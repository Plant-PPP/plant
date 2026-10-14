import type { Inngest } from "inngest";

import { inngestJobRunner } from "./job-runner";

it("starts an import with an event whose id is the import's", async () => {
  const send = jest.fn().mockResolvedValue({ ids: ["e1"] });
  await inngestJobRunner({ send } as unknown as Inngest).startImport({
    importId: "i1",
    userId: "u1",
  });
  expect(send).toHaveBeenCalledWith({
    id: "import-i1",
    name: "plant/import.requested",
    data: { importId: "i1", userId: "u1" },
  });
});

it("gives a retry its own event id, so the engine does not drop it as the first start", async () => {
  const send = jest.fn().mockResolvedValue({ ids: ["e2"] });
  await inngestJobRunner({ send } as unknown as Inngest).startImport({
    importId: "i1",
    userId: "u1",
    retry: "r1",
  });
  expect(send).toHaveBeenCalledWith({
    id: "import-i1-r1",
    name: "plant/import.requested",
    data: { importId: "i1", userId: "u1" },
  });
});
