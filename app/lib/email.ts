// Transactional email via Resend. Never throws: delivery problems must not
// break account flows; callers surface an "email not sent" state instead.

export type EmailMessage = { to: string; subject: string; text: string; html?: string };

export function emailConfigured(): boolean {
  return Boolean((process.env.RESEND_API_KEY ?? "").trim());
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  if (!key) return false;
  const from = (process.env.RESEND_FROM ?? "").trim() || "COWBOY <onboarding@resend.dev>";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}) }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
