import type {
  PortfolioSourcePort,
  SourceCapabilities,
  SourceInput,
  SourceReadInfo,
  SourceReading,
} from "../port";
import { SourceError } from "./draft";
import { PDF_PAGE_LIMIT, pdfPageCount } from "./pdf";

// Which reader takes each type Cargar uploads: a model reads documents and
// pictures as they are; spreadsheets are parsed in code.
export const FILE_TYPE_READERS = {
  "application/pdf": "document",
  "image/png": "document",
  "image/jpeg": "document",
  "image/webp": "document",
  "image/heic": "document",
  "text/csv": "sheet",
  "application/vnd.ms-excel": "sheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
} as const satisfies Record<string, SourceReadInfo["reader"]>;

export type FileUploadType = keyof typeof FILE_TYPE_READERS;

export type FileReader = (input: SourceInput) => Promise<SourceReading>;

const FILE_UPLOAD_CAPABILITIES: SourceCapabilities = {
  holdings: "native",
  movements: "native",
  incremental: "unsupported",
};

const isFileUploadType = (type: string): type is FileUploadType =>
  Object.hasOwn(FILE_TYPE_READERS, type);

// The file_upload source: hands each file to the reader for its type,
// refuses a type it does not take as unsupported, and a PDF longer than
// PDF_PAGE_LIMIT before any reader sees it.
export function fileUploadSource(
  readers: Record<SourceReadInfo["reader"], FileReader>,
): PortfolioSourcePort {
  return {
    kind: "file_upload",
    capabilities: () => FILE_UPLOAD_CAPABILITIES,
    read: (input) => {
      if (!isFileUploadType(input.mimeType)) {
        return Promise.reject(new SourceError("unsupported", false));
      }
      if (
        input.mimeType === "application/pdf" &&
        (pdfPageCount(input.bytes) ?? 0) > PDF_PAGE_LIMIT
      ) {
        return Promise.reject(new SourceError("too_many_pages", false));
      }
      return readers[FILE_TYPE_READERS[input.mimeType]](input);
    },
  };
}
