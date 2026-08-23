import { Hono } from 'hono'
import { Bindings } from '../types'
import { debugLog } from '../utils/logger'

const jobsRouter = new Hono<{ Bindings: Bindings }>()

// Mengambil daftar transaksi (inbox)
jobsRouter.get('/', async (c) => {
  debugLog(c.env, 'JOBS_API', 'Mengambil data transaksi (jobs)');
  try {
    // Mengambil 50 transaksi terbaru
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM jobs 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all();
    
    return c.json({ status: 'success', data: results });
  } catch (err: any) {
    debugLog(c.env, 'JOBS_ERROR', err.message);
    return c.json({ error: "Gagal mengambil data inbox", details: err.message }, 500);
  }
});

// Update status transaksi (opsional, jika Anda ingin menyelesaikannya secara manual)
jobsRouter.post('/:id/status', async (c) => {
  const id = c.req.param('id');
  const { status, notes } = await c.req.json();
  const now = new Date().toISOString();
  
  debugLog(c.env, 'JOBS_API', `Update status job ${id} menjadi ${status}`);

  try {
    let query = `UPDATE jobs SET status = ?, notes = ?`;
    let params = [status, notes];

    if (status === 'paid') {
      query += `, paid_at = ?`;
      params.push(now);
    } else if (status === 'cancelled') {
      query += `, cancelled_at = ?`;
      params.push(now);
    }

    query += ` WHERE id = ?`;
    params.push(id);

    await c.env.DB.prepare(query).bind(...params).run();
    return c.json({ status: 'success', message: 'Status berhasil diperbarui' });
  } catch (err: any) {
    debugLog(c.env, 'JOBS_ERROR', err.message);
    return c.json({ error: "Gagal mengupdate status", details: err.message }, 500);
  }
});

export default jobsRouter;
