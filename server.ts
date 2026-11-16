import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { getDb } from './src/server/db.ts';
import { attachLiveVoiceBroker } from './src/server/liveBroker.ts';
import { createApiRouter } from './src/server/routes.ts';

async function startServer(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const db = getDb();

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Mount API routes
  app.use('/api', createApiRouter(db));

  const httpServer = http.createServer(app);
  attachLiveVoiceBroker(httpServer, db);

  // Periodic cleanup of expired temporary uploaded files
  setInterval(() => {
    try {
      const expired = db
        .prepare("SELECT id, safe_name FROM file_records WHERE status != 'purged' AND datetime(expires_at) <= datetime('now')")
        .all() as Array<{ id: number; safe_name: string }>;
      const storageDir = path.resolve(process.cwd(), process.env.STORAGE_PATH || 'storage/uploads');
      for (const f of expired) {
        const target = path.join(storageDir, path.basename(f.safe_name));
        if (fs.existsSync(target)) {
          fs.unlinkSync(target);
        }
        db.prepare("UPDATE file_records SET status = 'purged', updated_at = datetime('now') WHERE id = ?").run(f.id);
      }
    } catch {
      // Ignore cleanup cycle error
    }
  }, 60_000).unref();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`NEXORA AI server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start NEXORA AI server:', err);
  process.exit(1);
});
