import { PORTFOLIO_SETUP_GUARD } from "./portfolio-setup";
import { lastFunctionBodies } from "./testing/migrations";

it("lists exactly the hints the portfolio setup guards raise", () => {
  const raised = [...lastFunctionBodies(/guard_\w+_write/).values()].flatMap(
    (body) =>
      [
        ...body.matchAll(
          new RegExp(
            `ERRCODE = '${PORTFOLIO_SETUP_GUARD.sqlstate}', HINT = '(\\w+)'`,
            "g",
          ),
        ),
      ].map(([, hint]) => hint),
  );
  expect(new Set(raised)).toEqual(new Set(PORTFOLIO_SETUP_GUARD.hints));
});
