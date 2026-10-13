// Hands the browser one file to save.
export function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

// A CSV as a file, with a byte order mark so a spreadsheet reads the accents
// as UTF-8.
export const csvBlob = (csv: string): Blob =>
  new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
