// Shotstash — Custom Next.js Server with GraphQL WebSocket
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
import { CLIENT_IP_HEADER } from './src/lib/clientIp';
import { signingSecret } from './src/lib/signingSecret';

// Fail closed before serving anything: signed share URLs need a real secret.
try {
  signingSecret();
} catch (err) {
  console.error(`[startup] ${(err as Error).message}`);
  process.exit(1);
}

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3005', 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Harus setelah prepare(): Next melempar kalau diminta lebih awal.
  const upgradeHandler = app.getUpgradeHandler();
  const server = createServer(async (req, res) => {
    try {
      // The only client IP the app trusts by default: the TCP peer. A client
      // cannot inject it because any incoming copy is replaced here.
      delete req.headers[CLIENT_IP_HEADER];
      req.headers[CLIENT_IP_HEADER] = req.socket.remoteAddress ?? '';
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Build GraphQL schema for subscriptions
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  // WebSocket Server for GraphQL subscriptions
  const wsServer = new WebSocketServer({ noServer: true });
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

  console.log('[WebSocket] GraphQL-WS server ready');

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
    console.log('[WS-UPGRADE]', pathname);
    if (pathname === '/api/graphql') {
      wsServer.handleUpgrade(request, socket, head, (ws) => {
        console.log('[WS-UPGRADE] connection upgraded');
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
    console.error(err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
