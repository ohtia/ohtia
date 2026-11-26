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
