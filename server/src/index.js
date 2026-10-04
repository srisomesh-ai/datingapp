import { PAYMENTS_MODE, PORT } from './config.js';
import { createServer } from './app.js';
import { endAllCalls } from './realtime/calls.js';

const { server } = createServer();
server.listen(PORT, () => {
  console.log(`API + realtime listening on http://localhost:${PORT} (payments: ${PAYMENTS_MODE})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    endAllCalls('shutdown');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
