// Entry point: `npm start`. Boots the server, prints what mode it is in, and shuts down cleanly
// on SIGTERM / SIGINT.

import { startServer } from './app.js';
import { ConfigError } from './config.js';

const SHUTDOWN_GRACE_MS = 10_000;

async function main() {
  let running;
  try {
    running = await startServer({ env: process.env });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
    } else if (error.code === 'EADDRINUSE') {
      console.error(`Port ${process.env.PORT ?? 8787} is already in use. Stop the other server or set PORT to a free port.`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }

  const { app, port } = running;
  const { config } = app;

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`${signal} received, finishing open requests…`);
    setTimeout(() => {
      console.error('Shutdown took too long; exiting.');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
    running.close().then(() => {
      console.log('Stopped.');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  for (const warning of app.warnings) console.warn(`WARNING: ${warning}`);
  let payments = 'OFF';
  if (config.paymentsMode === 'stripe') payments = config.stripeSecretKey.includes('_live_') ? 'Stripe (live)' : 'Stripe (test mode)';
  else if (config.paymentsMode === 'demo') payments = 'demo mode, no real charges';
  const address = config.production ? config.publicUrl : `http://localhost:${port}`;
  console.log(`Tsideh is running at http://localhost:${port}`);
  if (config.production) console.log(`  public address: ${config.publicUrl}`);
  console.log(`  payments: ${payments} · kitchen admin: ${config.adminPassword ? `${address}/admin` : 'off'} · data: ${config.dataDir}`);
  if (config.now !== null) console.log(`  clock frozen at ${new Date(config.now).toISOString()} (NOW)`);
}

await main();
