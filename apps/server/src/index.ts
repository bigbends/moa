import { buildApp } from './app.js';

const { app } = await buildApp();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
try { await app.listen({ host: process.env.MOA_HOST || '0.0.0.0', port: Number(process.env.MOA_PORT || 8795) }); }
catch (error) { app.log.error(error); process.exit(1); }
