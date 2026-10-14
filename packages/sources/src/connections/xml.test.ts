import { SourceError } from "../file-upload/draft";
import { elements, textOf } from "./xml";

describe("xml", () => {
  it("reads every element's attributes and decodes their references", () => {
    expect(
      elements(
        `<Rows><Row a="1" b='x &amp; y &#65;&#x42;' /><Rows2 a="no"/><Row a="2"></Row></Rows>`,
        "Row",
      ),
    ).toEqual([{ a: "1", b: "x & y AB" }, { a: "2" }]);
    expect(textOf("<R><Status> Success </Status></R>", "Status")).toBe(
      "Success",
    );
  });

  it.each(["&#1114112;", "&#x110000;", "&#99999999999;"])(
    "fails for good on %s, a reference to no character",
    (reference) => {
      let caught: unknown;
      try {
        elements(`<Row a="${reference}" />`, "Row");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SourceError);
      expect(caught).toMatchObject({
        code: "extraction_failed",
        retryable: false,
      });
    },
  );
});
