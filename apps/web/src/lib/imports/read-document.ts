import "server-only";
import type { ImportJobDeps, ImportRead } from "@plant/jobs";
import { SourceError } from "@plant/sources";

import type { UploadType } from "./upload";

type Reader = ImportRead["reader"];

// Which reader takes each type Cargar uploads: the model reads documents and
// pictures as they are; spreadsheets are parsed in code. A new upload type
// fails typecheck here until it has one.
const READER: Record<UploadType, Reader> = {
  "application/pdf": "document",
  "image/png": "document",
  "image/jpeg": "document",
  "image/webp": "document",
  "image/heic": "document",
  "text/csv": "sheet",
  "application/vnd.ms-excel": "sheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
};

// The import job's one reader, handing each file to the one for its type.
export function readDocument(
  readers: Record<Reader, ImportJobDeps["extract"]>,
): ImportJobDeps["extract"] {
  return (input) => {
    const reader = READER[input.mimeType as UploadType];
    if (!reader) return Promise.reject(new SourceError("unsupported", false));
    return readers[reader](input);
  };
}
