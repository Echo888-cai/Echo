/**
 * Contracts for src/server/routes/auth.js — mirrors current behavior only.
 *
 *   POST /api/auth/login    {username, password}                    → {user}
 *   POST /api/auth/register {invite, username, password, displayName?} → {user}
 *   POST /api/auth/logout   (no body)                                → {loggedOut}
 *   GET  /api/auth/me                                                → {user, multiUser}
 *   POST /api/auth/invite   {note?}  (owner only)                    → {code}
 *
 * All wrapped in the sendOk/sendError envelope (see envelope.ts).
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

/** Mirrors authService.publicUser(). */
export const publicUserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    displayName: z.string().nullable().optional(),
    role: z.enum(["owner", "member"])
  })
  .nullable();

export const authLoginRequestSchema = z.object({
  username: z.string(),
  password: z.string()
});
export const authLoginResponseSchema = okEnvelope(z.object({ user: publicUserSchema }));

export const authRegisterRequestSchema = z.object({
  invite: z.string(),
  username: z.string(),
  password: z.string(),
  displayName: z.string().optional()
});
export const authRegisterResponseSchema = okEnvelope(z.object({ user: publicUserSchema }));

export const authLogoutResponseSchema = okEnvelope(z.object({ loggedOut: z.literal(true) }));

export const authMeResponseSchema = okEnvelope(
  z.object({ user: publicUserSchema, multiUser: z.boolean() })
);

export const authInviteRequestSchema = z.object({ note: z.string().optional() });
export const authInviteResponseSchema = okEnvelope(z.object({ code: z.string() }));
