export const manuscriptFormat = "ohtia-markdown-v1";

export const manuscriptLimits = Object.freeze({
  documentBytes: 128 * 1024,
  paragraphCount: 256,
  textBytes: 8 * 1024,
});

export interface ManuscriptLine {
  readonly text: string;
  readonly breakAfter: "soft" | "hard" | null;
}

export interface ManuscriptParagraph {
  readonly id: string;
  readonly lines: readonly ManuscriptLine[];
}

export interface CanonicalManuscript {
  readonly format: typeof manuscriptFormat;
  readonly draftId: string;
  readonly title: { readonly id: string; readonly text: string } | null;
  readonly paragraphs: readonly ManuscriptParagraph[];
}

type DiagnosticLocation =
  | { readonly kind: "document" | "title" }
  | { readonly kind: "line" | "paragraph"; readonly number: number };

export interface ManuscriptDiagnostic {
  readonly code:
    | "document-limit"
    | "paragraph-limit"
    | "text-limit"
    | "invalid-text"
    | "invalid-header"
    | "invalid-version"
    | "invalid-id"
    | "foreign-draft"
    | "unavailable-id"
    | "duplicate-id"
    | "unsupported-construct"
    | "invalid-ast";
  readonly location: DiagnosticLocation;
}

export type ManuscriptResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: ManuscriptDiagnostic };

export type ManuscriptSaveReason = "manual" | "autosave";

export interface ManuscriptCreatePayload {
  readonly projectId: string;
  readonly title: string;
}

export interface ManuscriptSavePayload {
  readonly projectId: string;
  readonly draftId: string;
  readonly expectedRevisionId: string;
  readonly saveReason: ManuscriptSaveReason;
  readonly markdown: string;
}

export type ManuscriptIntent =
  | { readonly kind: "create"; readonly title: string }
  | (Omit<ManuscriptSavePayload, "projectId" | "markdown"> & {
      readonly kind: "save";
      readonly contentSha256: string;
    });

export interface ManuscriptSummary {
  readonly draftId: string;
  readonly title: string;
  readonly currentRevisionId: string;
}

export const manuscriptPageSize = 20;

export interface ManuscriptPage {
  readonly projectId: string;
  readonly manuscripts: readonly ManuscriptSummary[];
  readonly next: string | null;
}

export interface ManuscriptRevision {
  readonly projectId: string;
  readonly draftId: string;
  readonly revisionId: string;
  readonly parentRevisionId: string | null;
  readonly restorationOriginId: string | null;
  readonly language: string | null;
  readonly createdAt: string;
  readonly saveReason: "initial" | ManuscriptSaveReason | "restoration";
  readonly contentSha256: string;
  readonly authorKind: "researcher";
  readonly recordingActor: "utility";
}

export interface ManuscriptWriteResult {
  readonly resultId: string;
  readonly manuscriptChange: {
    readonly kind: "committed" | "conflict";
    readonly revision: ManuscriptRevision;
  };
}

export interface ManuscriptReceipt {
  readonly projectId: string;
  readonly operationId: string;
  readonly receipt: ManuscriptWriteResult | null;
}

export function isManuscriptSaveReason(value: unknown): value is ManuscriptSaveReason {
  return value === "manual" || value === "autosave";
}

export function isManuscriptLanguage(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length <= 255 &&
      /^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i.test(value))
  );
}
