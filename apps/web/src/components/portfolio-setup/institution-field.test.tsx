import { renderToStaticMarkup } from "react-dom/server";
import {
  INSTITUTIONS,
  InstitutionIcon,
  OTHER_INSTITUTION,
  chosenInstitution,
  institutionChoice,
  typedInstitution,
} from "./institution-field";

describe("institutionChoice", () => {
  it("starts empty for a new account", () => {
    expect(institutionChoice("")).toBe("");
  });

  it("picks a listed institution", () => {
    expect(institutionChoice("IOL")).toBe("IOL");
  });

  it("picks Otra for a name the list does not have", () => {
    expect(institutionChoice("Mi broker")).toBe(OTHER_INSTITUTION);
  });
});

describe("typedInstitution", () => {
  it("is empty for a listed name or a new account", () => {
    expect(typedInstitution("IOL")).toBe("");
    expect(typedInstitution("")).toBe("");
  });

  it("keeps any other name, the Otra value itself included", () => {
    expect(typedInstitution("Mi broker")).toBe("Mi broker");
    expect(typedInstitution(OTHER_INSTITUTION)).toBe(OTHER_INSTITUTION);
  });
});

describe("chosenInstitution", () => {
  it("saves the listed name, ignoring the Otra field", () => {
    expect(chosenInstitution("Balanz", "Mi broker")).toBe("Balanz");
  });

  it("saves the typed name under Otra", () => {
    expect(chosenInstitution(OTHER_INSTITUTION, "Mi broker")).toBe("Mi broker");
  });
});

describe("InstitutionIcon", () => {
  const render = (name: string) =>
    renderToStaticMarkup(<InstitutionIcon name={name} />);

  it("shows a listed institution's saved icon, hidden from screen readers", () => {
    expect(render("IOL")).toMatch(/<img[^>]*alt=""[^>]*>/);
  });

  it("fits a saved icon in its box without stretching it", () => {
    expect(render("IOL")).toMatch(/<img[^>]*class="[^"]*\bobject-contain\b/);
  });

  it("shows the initial of any other name", () => {
    const html = render("mi broker");
    expect(html).not.toContain("<img");
    expect(html).toMatch(/aria-hidden="true"[^>]*>M<\/span>/);
  });
});

it("never lists the Otra value as an institution", () => {
  expect(INSTITUTIONS).not.toContain(OTHER_INSTITUTION);
});
