/** The collaboration contract. The UI only ever talks to this; `MockCollabProvider` implements it
 *  today and a Yjs + WebSocket provider will implement it later. */

export type DocKind = "doc" | "sheet" | "canvas";

export interface Collaborator {
  id: string;
  name: string;
  /** 1..6, assigned in join order; maps to --seat-N. */
  seat: number;
}

/** Where a collaborator is, in the coordinates of the document kind. */
export type Position =
  | { kind: "doc"; pos: number } // ProseMirror position
  | { kind: "sheet"; row: number; col: number }
  | { kind: "canvas"; x: number; y: number };

export interface PresenceEvent {
  collaborator: Collaborator;
  position: Position | null; // null = idle / left
  typing?: boolean;
}

/** Opaque to the UI: the editor binding for each kind decides what an update contains. */
export interface DocUpdate {
  origin: string; // collaborator id
  kind: DocKind;
  payload: unknown;
}

export type Unsubscribe = () => void;
export type ConnectionState = "connecting" | "connected" | "offline";

export interface CollabProvider {
  connect(docId: string, kind: DocKind): Promise<void>;
  disconnect(): void;
  onPresence(cb: (e: PresenceEvent) => void): Unsubscribe;
  onUpdate(cb: (u: DocUpdate) => void): Unsubscribe;
  onState(cb: (s: ConnectionState) => void): Unsubscribe;
  sendUpdate(update: DocUpdate): void;
  /** Collaborators currently present, including their last known position. */
  peers(): PresenceEvent[];
}
