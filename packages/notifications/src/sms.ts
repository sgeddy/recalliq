// NOTE: Twilio adapter stub. Full implementation wires up the Twilio SDK once
// the notification job payload types are finalized.
// All calls go through BullMQ worker — never from apps/api request handlers.
// Incoming Twilio webhooks must be verified with signature verification before processing.

export interface SendSmsParams {
  to: string;
  body: string;
  from?: string;
}

export interface SendSmsResult {
  sid: string;
}

/**
 * Sends an SMS via Twilio.
 *
 * Credentials are read from environment variables
 * (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).
 * Never pass credentials as function arguments.
 */
export async function sendSms(params: SendSmsParams): Promise<SendSmsResult> {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  const fromNumber = params.from ?? process.env["TWILIO_FROM_NUMBER"];

  if (!accountSid) throw new Error("TWILIO_ACCOUNT_SID environment variable is not set");
  if (!authToken) throw new Error("TWILIO_AUTH_TOKEN environment variable is not set");
  if (!fromNumber) throw new Error("TWILIO_FROM_NUMBER environment variable is not set");

  const { default: twilio } = await import("twilio");
  const client = twilio(accountSid, authToken);

  const message = await client.messages.create({
    to: params.to,
    from: fromNumber,
    body: params.body,
  });

  return { sid: message.sid };
}
