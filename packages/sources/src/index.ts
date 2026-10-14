// The port every source implements, the file_upload adapter, what reading a
// file yields and how a source fails. Broker and exchange APIs arrive as other
// adapters.
export {
  FILE_TYPE_READERS,
  type FileReader,
  type FileUploadType,
  fileUploadSource,
} from "./file-upload/adapter";
export {
  createSourceForConnection,
  type PortfolioSourcePort,
  type SourceAdapters,
  type SourceCapabilities,
  sourceCapabilitiesSchema,
  type SourceInput,
  type SourceKind,
  sourceKindSchema,
  type SourceReadInfo,
  type SourceReading,
  supportSchema,
} from "./port";
export {
  DRAFT_ROW_LIMIT,
  type DraftRow,
  draftRowSchema,
  importConfidenceSchema,
  type ImportDraft,
  importDraftSchema,
  SourceError,
  type SourceErrorCode,
} from "./file-upload/draft";
