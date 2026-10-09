import { currentPath, signInAgain } from "./sign-in-again";

const assign = jest.fn();

beforeEach(() => {
  assign.mockReset();
  Object.assign(globalThis, {
    window: {
      location: { pathname: "/settings", search: "?confirm=disable", assign },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

it("comes back to this page with its query", () => {
  expect(currentPath()).toBe("/settings?confirm=disable");
  signInAgain();
  expect(assign).toHaveBeenCalledWith(
    "/login?next=%2Fsettings%3Fconfirm%3Ddisable&error=signed_out",
  );
});
