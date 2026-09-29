// Shotstash: custom Next.js server with GraphQL over WebSocket.
// Compiled by esbuild to dist/server.js for production (scripts/build-server.mjs);
// `npm run dev` runs this file directly with tsx.
import 'dotenv/config';
import { createServer, type IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './src/graphql/schema';
import { resolvers, type GraphQLContext } from './src/graphql/resolvers';
import { GraphQLError } from 'graphql';
import { validateSessionToken } from './src/lib/sessionStore';
import { CLIENT_IP_HEADER, requestScheme } from './src/lib/request';
import { signingSecret } from './src/lib/signingSecret';
import { isSetupComplete } from './src/lib/setupState';
import { allowedBeforeSetup, isApiPath } from './src/lib/setupGate';
import { closeDragonfly, dfClient, withLock } from './src/lib/dragonfly';
import { disconnectPrisma } from './src/lib/prisma';
import { purgeExpired } from './src/modules/trash';
import { ConfigError, assertConfig, config } from './src/lib/config';
import { errMessage, logger } from './src/lib/logger';
import type { Server, ServerResponse } from 'http';

const log = logger('server');
const sweepLog = logger('trash-sweeper');
const wsLog = logger('websocket');

/* ------------------------------------------------------------------ */
/* Security headers (Story 2.7): set here on every response, never in  */
/* next.config.ts. No CSP yet (deferred by the spine).                 */
/* ------------------------------------------------------------------ */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Frame-Options': 'DENY',
};

function headerReader(req: IncomingMessage) {
  return {
    get(name: string) {
      const v = req.headers[name.toLowerCase()];
      return Array.isArray(v) ? v.join(',') : (v ?? null);
    },
  };
}

function setSecurityHeaders(req: IncomingMessage, res: ServerResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  // HSTS only when the request really arrived over HTTPS (a trusted proxy's
  // x-forwarded-proto, see src/lib/request.ts); the Node server itself is plain HTTP.
  const scheme = requestScheme({ url: `http://localhost${req.url ?? '/'}`, headers: headerReader(req) });
  if (scheme === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/* ------------------------------------------------------------------ */
/* Setup gate (Story 2.6): until the first super admin exists, pages   */
/* redirect to /setup and /api, /media answer 503 SETUP_REQUIRED.      */
/* defineRoute() applies the same gate as a second layer.              */
/* ------------------------------------------------------------------ */
function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const UNAVAILABLE_HTML =
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>Service unavailable</title>' +
  '<body style="font-family:system-ui,sans-serif;padding:2rem"><h1>Service unavailable</h1>' +
  '<p>The server cannot reach its database right now. Try again in a moment.</p></body></html>';

/** True when the request was answered here (blocked before setup, or the check failed). */
async function setupGate(res: ServerResponse, pathname: string): Promise<boolean> {
  if (allowedBeforeSetup(pathname)) return false;
  let complete: boolean;
  try {
    complete = await isSetupComplete();
  } catch (err) {
    // Database down: say so instead of a generic 500 (and never a JSON page).
    logger('setup-gate').error('check failed', { err: errMessage(err) });
    if (isApiPath(pathname)) {
      sendJson(res, 503, { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' });
    } else {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(UNAVAILABLE_HTML);
    }
    return true;
  }
  if (complete) return false;
  if (isApiPath(pathname)) {
    sendJson(res, 503, { code: 'SETUP_REQUIRED', message: 'First-run setup is required' });
  } else {
    res.statusCode = 302;
    res.setHeader('Location', '/setup');
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Trash sweeper (Story 2.8): hourly, first run 60 s after boot. With  */
/* Dragonfly it runs only on the instance holding the lock; without a  */
/* lock store the app is a single instance and runs it directly. A     */
/* sweep stops after ~10 min so it stays inside the 15 min lock.       */
/* ------------------------------------------------------------------ */
const SWEEP_LOCK = 'shotstash:lock:trash-sweeper';
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const SWEEP_LOCK_TTL_MS = 15 * 60 * 1000;
const SWEEP_BUDGET_MS = 10 * 60 * 1000;

async function sweepTrash() {
  const run = () =>
    purgeExpired(config().SHOTSTASH_TRASH_RETENTION_DAYS, Date.now(), {
      deadline: Date.now() + SWEEP_BUDGET_MS,
    });
  try {
    const locked = await withLock(SWEEP_LOCK, SWEEP_LOCK_TTL_MS, run);
    let result;
    if (locked.ran) {
      result = locked.value;
    } else if (locked.reason === 'unavailable') {
      sweepLog.warn('no lock store (Dragonfly unavailable): running as a single instance');
      result = await run();
    } else {
      sweepLog.info('skipped: another instance holds the lock');
      return;
    }
    if (result.files || result.folders || result.stoppedEarly) {
      sweepLog.info('purged', { files: result.files, sections: result.folders, stoppedEarly: result.stoppedEarly });
    }
  } catch (err) {
    sweepLog.error('failed', { err: errMessage(err) });
  }
}

// Fail fast before serving anything: every bad variable is listed by name,
// and signed share URLs need a real secret.
try {
  assertConfig();
  signingSecret();
} catch (err) {
  const problems = err instanceof ConfigError ? err.problems : [errMessage(err)];
  log.fatal('invalid configuration, see .env.example and docs/configuration.md', { problems });
  // Also as plain lines, so a person reading `docker compose logs` sees them at once.
  for (const p of problems) process.stderr.write(`config: ${p}\n`);
  process.exit(1);
}

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = config().PORT;
// Connect to Dragonfly now, so the first health check finds it ready.
dfClient();
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

/* ------------------------------------------------------------------ */
/* Graceful shutdown (Story 6.1): `docker stop` sends SIGTERM and kills */
/* after the grace period (20 s in docker-compose.yml, 10 s by default). */
/* Handlers are installed before app.prepare(), so a stop during boot   */
/* exits at once. Open WebSockets are terminated, idle keep-alive       */
/* sockets closed, busy ones cut after a short grace, then Prisma and   */
/* Dragonfly disconnect. A fallback timer exits well inside 10 s.       */
/* ------------------------------------------------------------------ */
const SHUTDOWN_GRACE_MS = 3_000;
const SHUTDOWN_DEADLINE_MS = 8_000;
let httpServer: Server | null = null;
let wsClients: WebSocketServer | null = null;
let stopping = false;

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  setTimeout(() => process.exit(0), SHUTDOWN_DEADLINE_MS).unref();
  const done = () => {
    void Promise.allSettled([disconnectPrisma(), closeDragonfly()]).finally(() => process.exit(0));
  };
  if (!httpServer) return done();
  for (const ws of wsClients?.clients ?? []) ws.terminate();
  httpServer.close(done);
  httpServer.closeIdleConnections();
  setTimeout(() => httpServer?.closeAllConnections(), SHUTDOWN_GRACE_MS).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

app.prepare().then(() => {
  // Harus setelah prepare(): Next melempar kalau diminta lebih awal.
  const upgradeHandler = app.getUpgradeHandler();
  const server = createServer(async (req, res) => {
    try {
      // The only client IP the app trusts by default: the TCP peer. A client
      // cannot inject it because any incoming copy is replaced here.
      delete req.headers[CLIENT_IP_HEADER];
      req.headers[CLIENT_IP_HEADER] = req.socket.remoteAddress ?? '';
      setSecurityHeaders(req, res);
      const parsedUrl = parse(req.url!, true);
      if (await setupGate(res, parsedUrl.pathname ?? '/')) return;
      await handle(req, res, parsedUrl);
    } catch (err) {
      log.error('request failed', { url: req.url, err: errMessage(err) });
      // Part of a response already went out: nothing sensible can follow.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, { code: 'INTERNAL', message: 'Internal error' });
    }
  });

  // Build GraphQL schema for subscriptions
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  // WebSocket Server for GraphQL subscriptions
  const wsServer = new WebSocketServer({ noServer: true });
  wsClients = wsServer;
  const serverCleanup = useServer(
    {
      schema,
      // Every new subscription re-validates the Bearer session, so a logged-out
      // or deactivated user cannot keep subscribing on an open socket.
      onSubscribe: async (ctx) => {
        const params = (ctx.connectionParams ?? {}) as Record<string, unknown>;
        const raw = typeof params.authorization === 'string' ? params.authorization : '';
        const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
        const session = token ? await validateSessionToken(token).catch(() => null) : null;
        if (!session || !session.actor.active) {
          return [new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } })];
        }
        return undefined;
      },
      // Story 4.1: konteks langganan dibangun dengan aturan yang SAMA
      // dengan `src/app/api/graphql/route.ts` — token Bearer dari
      // `connectionParams.authorization` (dikirim `apollo-client.ts`)
      // divalidasi terhadap tabel `Session`; baris kedaluwarsa dihapus dan
      // hasilnya `null`, sehingga `context.userId` kosong dan resolver
      // langganan melempar `Unauthorized`. Dievaluasi per operasi
      // subscribe, bukan sekali per koneksi.
      context: async (ctx): Promise<GraphQLContext> => {
        const params = (ctx.connectionParams ?? {}) as Record<string, unknown>;
        const raw = typeof params.authorization === 'string' ? params.authorization : '';
        const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
        const session = token ? await validateSessionToken(token).catch(() => null) : null;
        const live = session && session.actor.active ? session : null;
        return {
          req: ctx.extra.request as unknown as Request,
          userId: live?.actor.id,
          sessionId: live?.id,
          sessionToken: live?.token,
          actor: live?.actor ?? null,
        };
      },
    },
    wsServer
  );

  wsLog.info('GraphQL-WS server ready');

  // Story 4.3: Next 16 (`next/dist/server/next.js` → setupWebSocketHandler)
  // memasang listener 'upgrade' miliknya SENDIRI ke server ini lewat
  // `req.socket.server` pada permintaan HTTP pertama. Listener itu
  // `socket.end()` setiap jalur upgrade yang cocok dengan sebuah rute —
  // termasuk /api/graphql — sehingga graphql-ws gagal "write after end"
  // sebelum `connection_ack` terkirim dan langganan `chatMessages` tidak
  // pernah menyala (ini sebab pesan pengguna lain tidak pernah tampil
  // tanpa muat ulang). Listener itu DITANGKAP lalu dilepas dari server
  // ('newListener' menyala SEBELUM listener ditambahkan, maka pelepasannya
  // ditunda satu tick); `handleUpgrade` di bawah membelokkan /api/graphql ke
  // graphql-ws dan meneruskan SEMUA jalur lain (HMR dev `/_next/*`, proxy)
  // ke listener Next yang sama persis — bukan `app.getUpgradeHandler()`,
  // yang di Next 16 adalah fungsi berbeda dan tidak melayani HMR, sehingga
  // klien dev tidak pernah tersambung dan halaman berhenti di "Loading...".
  type UpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  let nextUpgrade: UpgradeListener | null = null;

  const handleUpgrade: UpgradeListener = (request, socket, head) => {
    const { pathname } = parse(request.url!);
    wsLog.debug('upgrade', { path: pathname });
    if (pathname === '/api/graphql') {
      wsServer.handleUpgrade(request, socket, head, (ws) => {
        wsLog.debug('connection upgraded');
        wsServer.emit('connection', ws, request);
      });
    } else if (nextUpgrade) {
      nextUpgrade(request, socket, head);
    } else {
      // Belum ada permintaan HTTP pertama → Next belum memasang listenernya;
      // pakai handler upgrade publiknya sebagai cadangan.
      upgradeHandler(request, socket, head);
    }
  };

  server.on('newListener', (event, listener) => {
    if (event === 'upgrade' && listener !== handleUpgrade) {
      nextUpgrade = listener as UpgradeListener;
      process.nextTick(() => server.removeListener('upgrade', listener));
    }
  });
  server.on('upgrade', handleUpgrade);

  server.once('error', (err) => {
    log.fatal('server error', { err });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { err: reason instanceof Error ? reason : errMessage(reason) });
  });

  httpServer = server;
  server.listen(port, () => {
    log.info('ready', { url: `http://${hostname}:${port}`, version: config().version, dev });
    setTimeout(() => {
      void sweepTrash();
      setInterval(() => void sweepTrash(), SWEEP_EVERY_MS).unref();
    }, 60 * 1000).unref();
  });
});
