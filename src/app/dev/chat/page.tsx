import { notFound } from "next/navigation";
import { devChatEnabled } from "@/config/env";
import DevChat from "./DevChat";

export const dynamic = "force-dynamic";

export default function DevChatPage() {
  if (!devChatEnabled()) notFound();
  return <DevChat />;
}
