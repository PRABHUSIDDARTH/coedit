import jwt from "jsonwebtoken";

/** Audience claim the API puts on WebSocket tickets, so no other JWT it signs can be replayed here. */
export const TICKET_AUDIENCE = "coedit-sync";

const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export interface TicketClaims {
  userId: string;
  fileId: string;
  role: Role;
  name: string;
  color: string;
}

/**
 * Verify a ticket minted by the API (`POST /api/files/{id}/ws-ticket`) for one document.
 * Throws unless the signature (HS256), expiry and audience are valid, the ticket is bound to
 * `documentName`, and it carries a known role.
 */
export function verifyTicket(token: string, documentName: string, secret: string): TicketClaims {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"], audience: TICKET_AUDIENCE });
  if (typeof payload === "string") throw new Error("ticket payload is not an object");
  const { sub, file_id: fileId, role, name, color, exp } = payload;
  if (typeof exp !== "number") throw new Error("ticket has no expiry");
  if (typeof sub !== "string" || !sub) throw new Error("ticket has no subject");
  if (typeof fileId !== "string" || fileId !== documentName) throw new Error("ticket is for another file");
  if (!ROLES.includes(role)) throw new Error("ticket has an unknown role");
  return {
    userId: sub,
    fileId,
    role,
    name: typeof name === "string" && name ? name : "Anonymous",
    color: typeof color === "string" && color ? color : "#888888",
  };
}
