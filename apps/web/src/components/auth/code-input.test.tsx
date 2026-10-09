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
  // A length cap would cut a code the browser inserts after the digits already
  // there (autofill, a keyboard's clipboard suggestion), and disabling the
  // field while the code is checked would drop focus and the keyboard.
  expect(html).not.toMatch(/<input[^>]*\s(maxLength|disabled)[=\s>]/);
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

it("takes its name only from its label", () => {
  expect(html).not.toMatch(/aria-label/);
});

it("shows one digit per box and no caret while unfocused", () => {
  const full = renderToStaticMarkup(
    <CodeInput id="code" value="654321" onChange={() => {}} />,
  );
  for (const digit of "654321") expect(full).toContain(`>${digit}<`);
  expect(full).not.toMatch(/animate-pulse/);
});

it("lets taps through every box to the field", () => {
  for (const box of html.match(/<span aria-hidden="true"[^>]*>/g) ?? []) {
    expect(box).toMatch(/pointer-events-none/);
  }
});

it("is named by a label pointing at its id", () => {
  const out = renderToStaticMarkup(
    <>
      <label htmlFor="c">Código</label>
      <CodeInput id="c" value="1" onChange={() => {}} />
    </>,
  );
  expect(out).toMatch(/<label for="c">Código<\/label>/);
  expect(out).toMatch(/<input[^>]*id="c"/);
});
