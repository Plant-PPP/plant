import { isOrderRefusal } from "@plant/core";

import {
  MOVEMENT_DELETE_MESSAGES,
  MOVEMENT_MESSAGES,
  SAME_DAY_ORDER,
} from "./messages";

it.each([
  ["dialog", MOVEMENT_MESSAGES],
  ["delete", MOVEMENT_DELETE_MESSAGES],
])(
  "explains same-day order in the %s copy of exactly the refusals that depend on it",
  (_, messages) => {
    for (const [code, message] of Object.entries(messages)) {
      expect([code, message.includes(SAME_DAY_ORDER)]).toEqual([
        code,
        isOrderRefusal(code),
      ]);
    }
  },
);
