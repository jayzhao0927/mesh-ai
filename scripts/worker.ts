import { runWorkerOnce } from "../src/modules/messaging/worker";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 2000);
let stopping = false;

async function loop() {
  while (!stopping) {
    try {
      const { processed, sent } = await runWorkerOnce();
      if (processed || sent) {
        console.log(`[worker] processed=${processed} sent=${sent}`);
      }
    } catch (error) {
      console.error("[worker] tick failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

void loop();
