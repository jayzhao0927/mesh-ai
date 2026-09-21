import { NextResponse } from "next/server";
import { messagingProvider } from "@/modules/providers/messaging";
import { ingestInbound } from "@/modules/messaging/gateway";
import { DomainError } from "@/modules/shared/errors";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body too large" }, { status: 413 });
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  try {
    const { messages, payloadHash } = await messagingProvider().verifyAndNormalize(
      rawBody,
      headers,
    );
    const outcomes = [];
    for (const message of messages) {
      outcomes.push(await ingestInbound(message, payloadHash));
    }
    // Acknowledge only after everything is durably stored.
    return NextResponse.json({ outcomes }, { status: 202 });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
