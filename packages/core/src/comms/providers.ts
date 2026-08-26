import type { EmailProvider, ProviderReadiness, SendResult, SmsProvider } from "./types";

/**
 * Email and SMS providers.
 *
 * These make real HTTP calls to Resend and Twilio. They are written to be
 * honest in exactly one respect that matters more than any other: when they are
 * not configured, they say so and send nothing. They never return a fabricated
 * success, and they never invent a message id.
 *
 * No SDKs. Both APIs are a single POST, and pulling in two dependencies to
 * build one form body each would be more code to audit, not less — which
 * matters when the code in question is the thing that talks to real customers.
 */

/** A fetch-shaped seam so the request itself can be asserted on in tests. */
export type HttpTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const defaultTransport: HttpTransport = async (url, init) => {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status, text: () => response.text() };
};

function missingVars(env: Record<string, string | undefined>, names: string[]): string[] {
  return names.filter((name) => !env[name]?.trim());
}

// ---------------------------------------------------------------------------
// Email — Resend
// ---------------------------------------------------------------------------

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly transport: HttpTransport = defaultTransport
  ) {}

  readiness(): ProviderReadiness {
    const missing = missingVars(this.env, ["RESEND_API_KEY", "RESEND_FROM_EMAIL"]);
    if (missing.length === 0) {
      return { ready: true, provider: this.name, explanation: "Resend is configured.", missing: [] };
    }
    return {
      ready: false,
      provider: this.name,
      // Names the variable AND the account step, because a key alone is not
      // enough — Resend will not send from a domain it has not verified, and
      // that is a DNS change only the owner can make.
      explanation:
        missing.includes("RESEND_API_KEY") && missing.includes("RESEND_FROM_EMAIL")
          ? "Email is not set up yet. It needs a Resend API key (RESEND_API_KEY) and a verified from-address (RESEND_FROM_EMAIL). The from-address has to be on a domain verified in Resend, which is a DNS change."
          : `Email is not set up yet — still missing ${missing.join(" and ")}.`,
      missing,
    };
  }

  async send(message: { to: string; subject: string; body: string; replyTo?: string }): Promise<SendResult> {
    const readiness = this.readiness();
    if (!readiness.ready) {
      return { ok: false, providerMessageId: null, provider: this.name, error: readiness.explanation };
    }

    const payload: Record<string, unknown> = {
      from: this.env.RESEND_FROM_EMAIL,
      to: [message.to],
      subject: message.subject,
      text: message.body,
    };
    if (message.replyTo) payload.reply_to = message.replyTo;

    const response = await this.transport("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        providerMessageId: null,
        provider: this.name,
        error: `Resend refused it (HTTP ${response.status}): ${text.slice(0, 300)}`,
      };
    }

    let id: string | null = null;
    try {
      id = (JSON.parse(text) as { id?: string }).id ?? null;
    } catch {
      // A 2xx with an unparseable body means it probably sent but we cannot
      // prove which message it was. Reported as sent without an id rather than
      // as a failure, because retrying would send it twice.
      id = null;
    }
    return { ok: true, providerMessageId: id, provider: this.name, error: null };
  }
}

// ---------------------------------------------------------------------------
// SMS — Twilio
// ---------------------------------------------------------------------------

export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";

  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly transport: HttpTransport = defaultTransport
  ) {}

  readiness(): ProviderReadiness {
    const missing = missingVars(this.env, [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_NUMBER",
    ]);
    if (missing.length === 0) {
      return { ready: true, provider: this.name, explanation: "Twilio is configured.", missing: [] };
    }
    return {
      ready: false,
      provider: this.name,
      explanation: `SMS is not set up yet — missing ${missing.join(", ")}. Twilio needs an account SID, an auth token, and a number you own to send from.`,
      missing,
    };
  }

  async send(message: { to: string; body: string }): Promise<SendResult> {
    const readiness = this.readiness();
    if (!readiness.ready) {
      return { ok: false, providerMessageId: null, provider: this.name, error: readiness.explanation };
    }

    const sid = this.env.TWILIO_ACCOUNT_SID as string;
    const form = new URLSearchParams({
      To: message.to,
      From: this.env.TWILIO_FROM_NUMBER as string,
      Body: message.body,
    });

    const response = await this.transport(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${sid}:${this.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      }
    );

    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        providerMessageId: null,
        provider: this.name,
        error: `Twilio refused it (HTTP ${response.status}): ${text.slice(0, 300)}`,
      };
    }

    let id: string | null = null;
    try {
      id = (JSON.parse(text) as { sid?: string }).sid ?? null;
    } catch {
      id = null;
    }
    return { ok: true, providerMessageId: id, provider: this.name, error: null };
  }
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * Accepts everything and records it. For tests only.
 *
 * Deliberately NOT exported through the app's provider selection: a stub that
 * could be wired into production by accident is a stub that will eventually
 * tell someone their email sent when it did not.
 */
export class RecordingEmailProvider implements EmailProvider {
  readonly name = "recording";
  readonly sent: { to: string; subject: string; body: string }[] = [];
  constructor(private readonly ok = true) {}
  readiness(): ProviderReadiness {
    return { ready: true, provider: this.name, explanation: "Recording provider.", missing: [] };
  }
  async send(message: { to: string; subject: string; body: string }): Promise<SendResult> {
    this.sent.push(message);
    return this.ok
      ? { ok: true, providerMessageId: `rec_${this.sent.length}`, provider: this.name, error: null }
      : { ok: false, providerMessageId: null, provider: this.name, error: "Recording provider set to fail." };
  }
}

export class RecordingSmsProvider implements SmsProvider {
  readonly name = "recording";
  readonly sent: { to: string; body: string }[] = [];
  constructor(private readonly ok = true) {}
  readiness(): ProviderReadiness {
    return { ready: true, provider: this.name, explanation: "Recording provider.", missing: [] };
  }
  async send(message: { to: string; body: string }): Promise<SendResult> {
    this.sent.push(message);
    return this.ok
      ? { ok: true, providerMessageId: `rec_${this.sent.length}`, provider: this.name, error: null }
      : { ok: false, providerMessageId: null, provider: this.name, error: "Recording provider set to fail." };
  }
}
