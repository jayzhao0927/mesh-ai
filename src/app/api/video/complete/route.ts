import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/modules/shared/db";
import { sha256 } from "@/modules/shared/crypto";
import { completeVideo } from "@/modules/video/service";
import { DomainError } from "@/modules/shared/errors";

const bodySchema = z.object({ token: z.string().min(10).max(200) });

/**
 * Ends the call. The caller proves which session it may end by presenting its
 * own grant token; no database id is accepted from the browser.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const grant = await prisma.videoAccessGrant.findUnique({
    where: { tokenHash: sha256(parsed.data.token) },
  });
  if (!grant || grant.revokedAt || grant.expiresAt < new Date()) {
    return NextResponse.json({ error: "This link isn't valid" }, { status: 404 });
  }
  try {
    await completeVideo(grant.videoSessionId);
    return NextResponse.json({ completed: true, isMock: true });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    throw error;
  }
}
