import { NextResponse } from "next/server";
import { z } from "zod";
import { devChatEnabled } from "@/config/env";
import { confirmSignal, rejectSignal } from "@/modules/relationship/service";

const bodySchema = z.object({
  userId: z.string().min(1),
  signalId: z.string().min(1),
  action: z.enum(["confirm", "reject"]),
});

export async function POST(request: Request) {
  if (!devChatEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { userId, signalId, action } = parsed.data;
  const updated =
    action === "confirm" ? await confirmSignal(userId, signalId) : await rejectSignal(userId, signalId);
  if (!updated) {
    return NextResponse.json({ error: "Signal not found for this user" }, { status: 404 });
  }
  return NextResponse.json({ id: updated.id, reviewStatus: updated.reviewStatus });
}
