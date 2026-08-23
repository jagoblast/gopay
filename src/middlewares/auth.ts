import { getCookie, deleteCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'
import { MiddlewareHandler } from 'hono'
import { Bindings } from '../types'
import { debugLog } from '../utils/logger'

export const adminAuth: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const token = getCookie(c, 'admin_jwt')
  if (!token) {
    debugLog(c.env, 'AUTH', 'Akses ditolak: Tidak ada cookie admin_jwt');
    return c.redirect('/login')
  }
  
  try {
    const decoded = await verify(token, c.env.JWT_SECRET, 'HS256')
    if (decoded.user !== c.env.ADMIN_USER) throw new Error("Invalid user")
    await next()
  } catch (err) {
    debugLog(c.env, 'AUTH', 'Akses ditolak: JWT tidak valid atau expired');
    deleteCookie(c, 'admin_jwt')
    return c.redirect('/login')
  }
}
