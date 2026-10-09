const SVG_OPEN = /<svg\b[^>]*>/i;
const VIEW_BOX = /\bviewBox\s*=/i;
const RECT_TAG = /<rect\b[^>]*>/gi;
const RECT_AXIS = (name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([\\d.]+)["']`, "i");
const PX_DIM = (name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([\\d.]+)(?:px)?["']`, "i");

// Raw SVG markup, with an optional XML prologue, and not a data: URL.
export function isInlineQrSvg(markup: string): boolean {
  const trimmed = markup.trimStart();
  if (trimmed.length === 0 || /^data:/i.test(trimmed)) return false;
  return /<svg\b/i.test(trimmed);
}

// Auth's enroll QR is goqrsvg + svgo (DefaultQRSize=3): width and height, no
// viewBox, and WriteQrSVG paints At(x, y) at SVG (y, x). The dimensions are
// copied into a viewBox so the modules scale with the box, and each rect's
// axes are swapped so a camera reads the code that was encoded. Markup that
// already has a viewBox did not come from goqrsvg and is left alone.
export function withQrSvgViewBox(markup: string): string {
  if (!isInlineQrSvg(markup)) return markup;

  const start = markup.search(/<svg\b/i);
  if (start < 0) return markup;

  const svg = markup.slice(start);
  const open = svg.match(SVG_OPEN)?.[0];
  if (!open || VIEW_BOX.test(open)) return svg;

  const width = open.match(PX_DIM("width"))?.[1];
  const height = open.match(PX_DIM("height"))?.[1] ?? width;
  if (!width || !height) return svg;

  const scaled = svg.replace(
    /<svg\b/i,
    `<svg viewBox="0 0 ${width} ${height}"`,
  );
  return swapQrModuleAxes(scaled);
}

// The inverse of goqrsvg WriteQrSVG's x/y walk (aaronarduino/goqrsvg).
function swapQrModuleAxes(svg: string): string {
  return svg.replace(RECT_TAG, (tag) => {
    const x = tag.match(RECT_AXIS("x"))?.[1];
    const y = tag.match(RECT_AXIS("y"))?.[1];
    if (x == null || y == null || x === y) return tag;
    return tag
      .replace(RECT_AXIS("x"), `x="${y}"`)
      .replace(RECT_AXIS("y"), `y="${x}"`);
  });
}

// An <img> source for the QR: the markup never reaches the DOM as HTML, and
// the CSP allows data: images.
export function qrDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
