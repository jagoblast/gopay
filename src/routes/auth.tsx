import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { setCookie, deleteCookie } from 'hono/cookie'
import { Bindings } from '../types'
import { debugLog } from '../utils/logger'

const authRouter = new Hono<{ Bindings: Bindings }>()

authRouter.get('/login', (c) => {
  return c.html(
    <html lang="id">
      <head>
        <title>Login Pekerja OPAI</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-100 flex items-center justify-center h-screen font-sans">
        <div class="bg-white p-8 rounded-lg shadow-md w-96">
          <h1 class="text-2xl font-bold mb-6 text-center text-gray-800">Login Sistem</h1>
          <form method="POST" action="/api/auth/login" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700">Username</label>
              <input type="text" name="username" class="mt-1 block w-full border border-gray-300 rounded px-3 py-2" required />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700">Password</label>
              <input type="password" name="password" class="mt-1 block w-full border border-gray-300 rounded px-3 py-2" required />
            </div>
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Masuk Area Admin</button>
          </form>
        </div>
      </body>
    </html>
  )
})

authRouter.post('/api/auth/login', async (c) => {
  const body = await c.req.parseBody()
  debugLog(c.env, 'LOGIN', `Percobaan login untuk user: ${body.username}`);
  
  if (body.username === c.env.ADMIN_USER && body.password === c.env.ADMIN_PASS) {
    const payload = { user: body.username, exp: Math.floor(Date.now() / 1000) + 86400 }
    const token = await sign(payload, c.env.JWT_SECRET, 'HS256')
    setCookie(c, 'admin_jwt', token, { path: '/', httpOnly: true, secure: true, maxAge: 86400 })
    return c.redirect('/admin/dashboard')
  }
  
  return c.html(<div style="color:red;text-align:center;margin-top:50px;">Kredensial Salah! <a href="/login">Kembali</a></div>, 401)
})

authRouter.get('/api/auth/logout', (c) => {
  deleteCookie(c, 'admin_jwt', { path: '/' })
  return c.redirect('/login')
})

export default authRouter
