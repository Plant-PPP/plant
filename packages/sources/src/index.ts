// The port every source implements, the file_upload adapter, what reading a
// file yields and how a source fails, and the brokers and exchanges read by
// API.
export {
  type ConnectionAdapters,
  connectionAdapters,
  type ConnectionProvider,
  CONNECTION_PROVIDERS,
  connectionProviderSchema,
} from "./connections/adapters";
export {
  CONNECTION_DRAFTS,
  type ConnectionDeps,
  type ConnectionDraft,
  connectionDraftSchema,
  type ConnectionProviderPort,
  type CredentialField,
  type Credentials,
  type ReadOnlyCheck,
  type ReadPeriod,
} from "./connections/port";
export {
  FILE_TYPE_READERS,
  type FileReader,
  type FileUploadType,
  fileUploadSource,
} from "./file-upload/adapter";
export {
  type IolMovementKind,
  type IolMovementRow,
  type IolMovements,
  readIolMovements,
} from "./file-upload/iol-movements";
export { PDF_PAGE_LIMIT, pdfPageCount } from "./file-upload/pdf";
export {
  createSourceForConnection,
  DEBT_DOCUMENT_KINDS,
  type DebtsReading,
  type HoldingsReading,
  type OperationsReading,
  OPERATION_DOCUMENT_KINDS,
  type DocumentKind,
  documentKindSchema,
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
  DRAFT_DEBT_LIMIT,
  DRAFT_ROW_LIMIT,
  type DraftDebt,
  draftDebtSchema,
  type DraftOperation,
  draftOperationSchema,
  OPERATION_KINDS,
  type DraftRow,
  draftAssetClassSchema,
  draftRowSchema,
  importConfidenceSchema,
  type ImportDraft,
  importDraftSchema,
  SourceError,
  type SourceErrorCode,
} from "./file-upload/draft";
