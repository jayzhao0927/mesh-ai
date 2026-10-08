import { buildApp } from './app.js';
import { config } from './config.js';
import { runMatchingCycle } from './matching-cycle.js';

const app = await buildApp();
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try { await runMatchingCycle(); }
  catch (err) { app.log.error(err, '匹配周期处理失败，将在下一周期重试'); }
  finally { running = false; }
}
// API access enforces deadlines; idle users are swept/refilled every minute.
const timer = setInterval(() => { void tick(); }, 60_000);
timer.unref();
app.addHook('onClose', async () => { clearInterval(timer); });
app.addHook('onListen', async () => { void tick(); });

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
