import { AccountError } from "../../lib/account-store";
import { emailConfigured, sendEmail } from "../../lib/email";
import { getAccountBackend, type AccountBackend } from "../../lib/store-backend";
import { assertSameOrigin, MutationLimiter, readJson, response, safely, sessionToken } from "./handlers";

const TOKEN_TTL_NOTE = "This link expires soon. If you did not request it, ignore this email.";

function appOrigin(request: Request): string {
  return new URL(request.url).origin;
}

async function notifyEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  return sendEmail({ to, subject, text });
}

export function createEmailHandlers({ store = getAccountBackend(), limiter = new MutationLimiter() }: { store?: AccountBackend; limiter?: MutationLimiter } = {}) {
  return {
    POST: (request: Request) => safely(async () => {
      assertSameOrigin(request);
      limiter.check("email", 10);
      const token = sessionToken(request);
      if (!token) throw new AccountError("unauthorized", "Sign in to manage your free picks.", 401);
      const body = await readJson(request, ["email"]);
      if (typeof body.email !== "string") throw new AccountError("invalid_input", "Supply an email address.");
      const result = await store.setEmail(token, body.email);
      const link = `${appOrigin(request)}/api/account/email/verify?token=${result.verifyToken}`;
      const sent = await notifyEmail(result.email,
        "Verify your COWBOY email",
        `Confirm this email for your COWBOY account:\n\n${link}\n\n${TOKEN_TTL_NOTE}`);
      return response({ email: result.email, emailSent: sent });
    }),
    VERIFY: (request: Request) => safely(async () => {
      const token = new URL(request.url).searchParams.get("token") ?? "";
      const ok = /^[a-f0-9]{64}$/.test(token) && await store.verifyEmail(token);
      return Response.redirect(`${appOrigin(request)}/?email=${ok ? "verified" : "invalid"}`, 303);
    }),
  };
}

export function createPasswordResetHandlers({ store = getAccountBackend(), limiter = new MutationLimiter() }: { store?: AccountBackend; limiter?: MutationLimiter } = {}) {
  return {
    REQUEST: (request: Request) => safely(async () => {
      assertSameOrigin(request);
      limiter.check("password-reset", 5);
      const body = await readJson(request, ["username"]);
      if (typeof body.username !== "string" || body.username.length > 64) {
        throw new AccountError("invalid_input", "Supply a username.");
      }
      const result = await store.requestPasswordReset(body.username);
      if (result) {
        const link = `${appOrigin(request)}/reset-password?token=${result.resetToken}`;
        await notifyEmail(result.email,
          "Reset your COWBOY password",
          `Reset the password for your COWBOY account:\n\n${link}\n\n${TOKEN_TTL_NOTE} This link works once and expires in one hour.`);
      }
      // Identical response whether or not the account exists or has email.
      return response({ ok: true, message: "If an account with a recovery email exists, a reset link is on its way." });
    }),
    CONFIRM: (request: Request) => safely(async () => {
      assertSameOrigin(request);
      limiter.check("password-reset-confirm", 10);
      const body = await readJson(request, ["token", "password"]);
      if (typeof body.token !== "string" || typeof body.password !== "string") {
        throw new AccountError("invalid_input", "Supply a reset token and new password.");
      }
      await store.resetPassword(body.token, body.password);
      return response({ ok: true });
    }),
  };
}
