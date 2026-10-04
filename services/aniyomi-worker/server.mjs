import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJavaTools } from './java-tools.mjs';
import { Runtime } from './runtime.mjs';
import { createBridgeServer } from './http.mjs';

const secret = (await readFile(process.env.MOA_APK_SECRET_FILE || '/run/secrets/apk-token', 'utf8')).trim();
const runtime = await new Runtime(process.env.MOA_APK_DATA || '/data', await createJavaTools(resolve('build'))).open();
const server = createBridgeServer(runtime, secret);
server.listen(Number(process.env.MOA_APK_PORT || 8797), '0.0.0.0');
let closing = false;
async function stop() {
  if (closing) return; closing = true;
  server.close(); server.closeAllConnections(); await runtime.close();
}
process.on('SIGTERM', () => stop().finally(() => process.exit()));
process.on('SIGINT', () => stop().finally(() => process.exit()));
