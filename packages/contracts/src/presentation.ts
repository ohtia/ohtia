import type { AppearanceRecord, PortError } from "./port.js";

export const characterPresentations = ["animated", "static", "hidden"] as const;
export type CharacterPresentation = (typeof characterPresentations)[number];
export const interfaceZooms = [75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400] as const;
export type InterfaceZoom = (typeof interfaceZooms)[number];
export const zoomBoundaryErrors = ["zoom_minimum", "zoom_maximum", "actual_size"] as const;
export type ZoomBoundaryError = (typeof zoomBoundaryErrors)[number];
export function isZoomBoundaryError(value: unknown): value is ZoomBoundaryError {
  return typeof value === "string" && zoomBoundaryErrors.some((code) => code === value);
}
export type ZoomIntent = "increase" | "decrease" | "reset";
export interface PresentationValues {
  character: CharacterPresentation;
  zoom: InterfaceZoom;
}
export type PresentationFeature = keyof PresentationValues;
export interface PresentationRecord<T> {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly value: T;
  readonly source: "saved" | "default" | "invalid_fallback";
}
export type SavedPresentationRecord<T> = PresentationRecord<T> & { readonly source: "saved" };
export interface PresentationChange<T> {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly value: T;
}
export type PresentationReceipt<T> =
  | { readonly state: "pending" | "not_found" }
  | {
      readonly state: "recorded";
      readonly outcome:
        | { readonly ok: true; readonly value: SavedPresentationRecord<T> }
        | {
            readonly ok: false;
            readonly error: Extract<
              PortError,
              { readonly code: "stale_revision" | (T extends number ? ZoomBoundaryError : never) }
            >;
          };
    };
export interface PresentationSnapshot {
  readonly serviceGeneration: string;
  readonly appearance: AppearanceRecord;
  readonly character: PresentationRecord<CharacterPresentation>;
  readonly zoom: PresentationRecord<InterfaceZoom>;
}
export function isCharacterPresentation(value: unknown): value is CharacterPresentation {
  return value === "animated" || value === "static" || value === "hidden";
}
export function isInterfaceZoom(value: unknown): value is InterfaceZoom {
  return typeof value === "number" && interfaceZooms.some((item) => item === value);
}
export function nextInterfaceZoom(value: InterfaceZoom, intent: ZoomIntent): InterfaceZoom {
  if (intent === "reset") return 100;
  const index = interfaceZooms.indexOf(value);
  return (
    interfaceZooms[
      Math.max(0, Math.min(interfaceZooms.length - 1, index + (intent === "increase" ? 1 : -1)))
    ] ?? 100
  );
}
