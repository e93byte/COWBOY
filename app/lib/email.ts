// Transactional email. Resend is preferred when RESEND_API_KEY is set;
// otherwise SMTP (e.g. Gmail app password) is used when SMTP_HOST is set.
// Never throws: delivery problems must not break account flows.

export type EmailMessage = { to: string; subject: string; text: string; html?: string };

function resendKey(): string { return (process.env.RESEND_API_KEY ?? "").trim(); }
function smtpConfig() {
  const host = (process.env.SMTP_HOST ?? "").trim();
  if (!host) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? 465) || 465,
    secure: (process.env.SMTP_SECURE ?? "true") !== "false",
    user: (process.env.SMTP_USER ?? "").trim(),
    pass: (process.env.SMTP_PASS ?? "").trim(),
    from: (process.env.EMAIL_FROM ?? "").trim() || undefined,
  };
}

export function emailConfigured(): boolean {
  const resendFrom = (process.env.RESEND_FROM ?? "").trim();
  const smtp = smtpConfig();
  return Boolean((resendKey() && resendFrom) || (smtp && (smtp.from || smtp.user)));
}

async function sendViaResend(message: EmailMessage, key: string): Promise<boolean> {
  const from = (process.env.RESEND_FROM ?? "").trim();
  if (!from) return false;
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

async function sendViaSmtp(message: EmailMessage, config: NonNullable<ReturnType<typeof smtpConfig>>): Promise<boolean> {
  try {
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
    await transport.sendMail({
      from: config.from ?? (config.user ? `COWBOY <${config.user}>` : "COWBOY"),
      to: message.to, subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const key = resendKey();
  if (key && (process.env.RESEND_FROM ?? "").trim()) return sendViaResend(message, key);
  const smtp = smtpConfig();
  if (smtp) return sendViaSmtp(message, smtp);
  return false;
}
