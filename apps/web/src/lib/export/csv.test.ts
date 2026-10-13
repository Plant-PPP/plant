import { toCsv } from "./csv";

it("writes a header and rows, CRLF between lines", () => {
  expect(
    toCsv(
      ["a", "b"],
      [
        ["1", "x"],
        ["2", null],
      ],
    ),
  ).toBe("a,b\r\n1,x\r\n2,");
});

it("quotes a field with a comma, a quote or a line break", () => {
  expect(toCsv(["n"], [["IOL, Largo"], ['dijo "hola"'], ["dos\nlíneas"]])).toBe(
    'n\r\n"IOL, Largo"\r\n"dijo ""hola"""\r\n"dos\nlíneas"',
  );
});

it.each([
  ["=1+1", "'=1+1"],
  ["+54 11", "'+54 11"],
  ["@SUM(A1)", "'@SUM(A1)"],
  ["-x", "'-x"],
  ["\tcmd", "'\tcmd"],
])("defuses %j as a formula", (value, written) => {
  expect(toCsv(["n"], [[value]])).toBe(`n\r\n${written}`);
});

it.each(["-5", "-0.25", "120000.5", "-.5"])(
  "leaves the number %s as it is",
  (value) => {
    expect(toCsv(["n"], [[value]])).toBe(`n\r\n${value}`);
  },
);
