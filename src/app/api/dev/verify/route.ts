import { NextResponse } from "next/server";
import { z } from "zod";
import { devChatEnabled } from "@/config/env";
import { completeVerification, startVerification } from "@/modules/verification/service";
import { DomainError } from "@/modules/shared/errors";

const bodySchema = z.object({ userId: z.string().min(1) });

/**
 * Development shortcut that runs the mock verification start/complete pair in
 * one call. Mock verification is not identity proof.
 */
export async function POST(request: Request) {
  if (!devChatEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  try {
    const { token } = await startVerification(parsed.data.userId);
    const result = await completeVerification(token);
    return NextResponse.json({ userId: result.userId, verified: true, isMock: true });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    throw error;
  }
}
