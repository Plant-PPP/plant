import { renderToStaticMarkup } from "react-dom/server";
import { OTP_LENGTH } from "@/lib/auth/otp-config";
import { CodeInput } from "./code-input";

const html = renderToStaticMarkup(
  <CodeInput id="code" value="12" onChange={() => {}} />,
);

it("is one field the phone can fill with the mailed code", () => {
  expect(html.match(/<input/g)).toHaveLength(1);
  expect(html).toContain('autoComplete="one-time-code"');
  expect(html).toContain('inputMode="numeric"');
  // A length cap would drop a code pasted after the digits already there, and
  // disabling it while the code is checked would drop focus and the keyboard.
  expect(html).not.toMatch(/maxLength|disabled/);
});

it("takes the id its label points at", () => {
  expect(html).toMatch(/<input[^>]*id="code"/);
});

it("is 16px, so iOS does not zoom into it", () => {
  expect(html).toMatch(/<input[^>]*class="[^"]*\btext-base\b/);
});

it("hides the boxes from screen readers", () => {
  expect(html.match(/aria-hidden="true"/g)).toHaveLength(OTP_LENGTH);
});
