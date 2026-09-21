import { redeemVideoToken } from "@/modules/video/service";
import { DomainError } from "@/modules/shared/errors";
import { VideoRoom } from "./VideoRoom";

export const dynamic = "force-dynamic";

export default async function VideoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  try {
    const room = await redeemVideoToken(token);
    return <VideoRoom token={token} room={{ ...room, scheduledAt: room.scheduledAt.toISOString() }} />;
  } catch (error) {
    const message =
      error instanceof DomainError ? error.message : "This link can't be opened.";
    return (
      <div className="max-w-xl space-y-4">
        <h1 className="editorial text-3xl">Not available</h1>
        <p className="text-muted">{message}</p>
        <p className="text-sm text-muted">
          Video links are personal, time-limited and stop working once the call is over.
          Ask your Agent for a new one if you still need it.
        </p>
      </div>
    );
  }
}
