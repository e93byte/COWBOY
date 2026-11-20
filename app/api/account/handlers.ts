import { AccountError, SESSION_MAX_AGE } from "../../lib/account-store";
import { getAccountBackend, type AccountBackend } from "../../lib/store-backend";

export const SESSION_COOKIE = "cowboy_session";
export function response(payload: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(payload, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", ...extra } });
}
export async function safely(action: () => Promise<Response>): Promise<Response> {
  try { return await action(); }
  catch (error) {
    if (error instanceof AccountError) return response({ error: error.code, message: error.message }, error.status);
    return response({ error: "service_unavailable", message: "The local account service is temporarily unavailable. Please try again." }, 409);
  }
}
export function sessionToken(request: Request): string | null {
  const cookies = (request.headers.get("cookie") ?? "").split(";");
  const entries = cookies.filter((cookie) => cookie.trim().startsWith(SESSION_COOKIE + "="));
  // Duplicate cookie names can arrive from different paths/domains. Never guess an identity.
  return entries.length === 1 ? entries[0].trim().slice(SESSION_COOKIE.length + 1) : null;
}
export function sessionCookie(request: Request, token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
export function assertSameOrigin(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") || url.host;
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase();
  const targetProtocol = forwardedProtocol ? `${forwardedProtocol.replace(/:$/, "")}:` : url.protocol.toLowerCase();
  let suppliedOrigin: URL | null = null;
  try { if (origin) suppliedOrigin = new URL(origin); } catch { /* Rejected below. */ }
  // Next.js and reverse proxies can expose an internal request URL that differs
  // from the public Host. Compare the browser Origin with the incoming Host and
  // externally forwarded protocol instead of trusting that internal URL.
  if (!suppliedOrigin || suppliedOrigin.origin === "null"
    || suppliedOrigin.host.toLowerCase() !== host.toLowerCase()
    || suppliedOrigin.protocol.toLowerCase() !== targetProtocol
    || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AccountError("cross_origin", "Mutating requests require the same Origin as this application.");
  }
}

export class MutationLimiter {
  private readonly buckets = new Map<string, { count: number; until: number }>();
  private readonly now: () => number;
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(options: { now?: () => number; limit?: number; windowMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.limit = options.limit ?? 10;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
  }
  check(key: string, limit = this.limit) {
    const now = this.now();
    for (const [name, entry] of this.buckets) if (entry.until <= now) this.buckets.delete(name);
    const current = this.buckets.get(key) ?? { count: 0, until: now + this.windowMs };
    if (current.count >= limit || (!this.buckets.has(key) && this.buckets.size >= 10000)) {
      throw new AccountError("rate_limited", "Too many attempts. Please wait before trying again.", 409);
    }
    current.count++;
    this.buckets.set(key, current);
  }
}

const limiterGlobals = globalThis as typeof globalThis & { cowboyMutationLimiters?: Map<string, MutationLimiter> };
export function sharedMutationLimiter(name: string, options: ConstructorParameters<typeof MutationLimiter>[0] = {}) {
  const limiters = limiterGlobals.cowboyMutationLimiters ??= new Map();
  let limiter = limiters.get(name);
  if (!limiter) { limiter = new MutationLimiter(options); limiters.set(name, limiter); }
  return limiter;
}

export async function readJson(request: Request, fields: string[]): Promise<Record<string, unknown>> {
  const invalid = () => new AccountError("invalid_input", "Supply a valid JSON object with only the supported fields (maximum 4096 bytes).");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw invalid();
  if (Number(request.headers.get("content-length")) > 4096) throw invalid();
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) { await reader.cancel(); throw invalid(); }
      chunks.push(chunk.value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !fields.includes(key))) throw invalid();
    return body as Record<string, unknown>;
  } catch { throw invalid(); }
  finally { reader.releaseLock(); }
}

export function createAccountHandlers({ store = getAccountBackend(), limiter = new MutationLimiter() }: { store?: AccountBackend; limiter?: MutationLimiter } = {}) {
  return {
    GET: (request: Request) => safely(async () => response({ user: await store.getUser(sessionToken(request)) })),
    POST: (request: Request) => safely(async () => {
      assertSameOrigin(request);
      limiter.check("account-global", 60);
      const body = await readJson(request, ["action", "username", "password"]);
      if ((body.action !== "register" && body.action !== "login") || typeof body.username !== "string" || typeof body.password !== "string") {
        throw new AccountError("invalid_input", "Supply an action, username and password.");
      }
      limiter.check("account:" + body.username.slice(0, 128).toLowerCase());
      const result = await store[body.action](body.username, body.password);
      return response({ user: result.user }, 200, { "Set-Cookie": sessionCookie(request, result.token, SESSION_MAX_AGE) });
    }),
    DELETE: (request: Request) => safely(async () => {
      assertSameOrigin(request);
      limiter.check("logout", 60);
      await store.logout(sessionToken(request));
      return response({ user: null }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
    }),
  };
}
