import assert from "node:assert/strict";
import { test } from "node:test";
import { emailConfigured, sendEmail } from "../app/lib/email";

test("email is unavailable without a configured real sender identity", async () => {
  const keys = ["RESEND_API_KEY", "RESEND_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"] as const;
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    for (const key of keys) delete process.env[key];
    process.env.RESEND_API_KEY = "test-key-without-sender";
    globalThis.fetch = async () => { requests++; return Response.json({ id: "fake" }); };
    assert.equal(emailConfigured(), false);
    assert.equal(await sendEmail({ to: "person@example.test", subject: "Verify", text: "Link" }), false);
    assert.equal(requests, 0, "do not send account mail from a generic onboarding address");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
