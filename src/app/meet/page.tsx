import Link from "next/link";
import { messagingProvider } from "@/modules/providers/messaging";
import { devChatEnabled } from "@/config/env";

export const dynamic = "force-dynamic";

export default function MeetPage() {
  // Deep-link rules come from the adapter, never from this page.
  const entry = messagingProvider().startEntry();

  return (
    <div className="max-w-2xl space-y-10">
      <div className="space-y-4">
        <h1 className="editorial text-4xl">Meet your Agent</h1>
        <p className="text-muted">
          Send the first message. Your Agent replies in Messages, gets to know you over
          time, and only then looks for someone worth meeting.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-white p-6">
        <p className="text-sm text-muted">Starting message</p>
        <p className="editorial mt-2 text-2xl">{entry.prefilledBody}</p>

        {entry.available ? (
          <div className="mt-6 space-y-3">
            <a
              href={entry.deepLink ?? entry.smsLink}
              className="inline-block rounded-full bg-accent px-6 py-3 text-white"
            >
              Open Messages
            </a>
            <p className="text-sm text-muted">
              If that does not open, text {entry.phoneNumber} from your phone.
            </p>
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-line bg-background p-4 text-sm text-muted">
            <p className="font-medium text-foreground">Messaging is not open yet.</p>
            <p className="mt-1">{entry.unavailableReason}</p>
            <p className="mt-1">
              No Agent number is shown because none has been provisioned in this
              environment.
            </p>
          </div>
        )}
      </div>

      {devChatEnabled() && (
        <p className="text-sm text-muted">
          Development only:{" "}
          <Link href="/dev/chat" className="underline">
            simulate the messaging channel
          </Link>
          .
        </p>
      )}
    </div>
  );
}
