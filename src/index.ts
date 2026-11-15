import { Hono } from 'hono';

// Vercel UI preview only. Backend and its SQLite data files remain in backend.ts
// and are started only by src/server.ts on a persistent Bun host.
const app = new Hono();
app.get('/', (c) => c.redirect('/index.html', 302));
app.get('/api/health', (c) => c.json({
  ok: true,
  service: 'SnapAttend',
  mode: 'ui-preview',
  persistent: false,
  backendReady: false,
  message: 'UI preview only. Attendance, Safe-Reach and guardian messaging are disabled.',
}));
app.all('/api/*', (c) => c.json({
  error: 'UI preview only. No data has been saved or messages sent. A persistent Bun + SQLite backend is required.',
  mode: 'ui-preview',
}, 503));
app.notFound((c) => c.json({error: 'Not found'}, 404));
export default app;
