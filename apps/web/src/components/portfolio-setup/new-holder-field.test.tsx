jest.mock("@/app/(app)/accounts/actions", () => ({ createHolder: jest.fn() }));

import { renderToStaticMarkup } from "react-dom/server";
import { NewHolderField, submitOnEnter } from "./new-holder-field";

const html = renderToStaticMarkup(
  <NewHolderField
    onCreated={() => {}}
    onCancel={() => {}}
    onPendingChange={() => {}}
  />,
);

it("has no form of its own and nothing the account's form would send", () => {
  expect(html).not.toContain("<form");
  expect(html.match(/<input/g)).toHaveLength(1);
  expect(html).not.toMatch(/<input[^>]*\s(name|required|maxLength)[=\s>]/i);
});

it("never submits the account's form with its buttons", () => {
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  expect(buttons).toHaveLength(2);
  for (const button of buttons) expect(button).toContain('type="button"');
});

describe("submitOnEnter", () => {
  it("saves the holder on Enter and keeps the form from submitting", () => {
    const submit = jest.fn();
    const preventDefault = jest.fn();
    submitOnEnter(submit)({ key: "Enter", preventDefault });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("lets other keys type", () => {
    const submit = jest.fn();
    const preventDefault = jest.fn();
    submitOnEnter(submit)({ key: "a", preventDefault });
    expect(submit).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
