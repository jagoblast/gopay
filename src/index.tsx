import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { Bindings } from './types'

import { adminAuth } from './middlewares/auth'
import authRouter from './routes/auth'
import gopayRouter from './routes/gopay'
import dashboardRouter from './routes/dashboard'
import jobsRouter from './routes/jobs' // <-- IMPORT ROUTER BARU

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', logger())

app.get('/', (c) => c.redirect('/login'))

app.route('/', authRouter)

// Proteksi akses untuk semua rute yang berawalan /admin/*
app.use('/admin/*', adminAuth)

// Router Khusus Admin
app.route('/admin/dashboard', dashboardRouter)
app.route('/admin/api/gopay', gopayRouter)
app.route('/admin/api/jobs', jobsRouter) // <-- DAFTARKAN ROUTER BARU

export default app
