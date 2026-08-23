import { Hono } from 'hono'
import { randomBytes, randomUUID } from 'node:crypto'
import { Bindings } from '../types'
import { debugLog } from '../utils/logger'
import { generateXm1, gojekFetch, CLIENT_ID, CLIENT_SECRET } from '../utils/gojek'

const gopayRouter = new Hono<{ Bindings: Bindings }>()
const getNowIso = () => new Date().toISOString()

gopayRouter.post('/request-otp', async (c) => {
  const { phone, pin, channel } = await c.req.json()
  const local = phone.replace('+62', '').replace(/^0/, '')
  const fullPhone = `+62${local}`
  
  debugLog(c.env, 'GOPAY_REQ_OTP', `Memulai proses untuk: ${fullPhone} via ${channel}`);

  try {
    let acc = await c.env.DB.prepare(`SELECT * FROM gopay_accounts WHERE phone = ?`).bind(fullPhone).first()
    if (!acc) {
      const uniqueid = randomBytes(4).toString('hex')
      const session_id = randomUUID()
      const xm1 = generateXm1(Date.now()-86400000, "123456", "02:00:00:00:00:00")
      await c.env.DB.prepare(`INSERT INTO gopay_accounts (phone, pin, uniqueid, session_id, registered_at, auth_state) VALUES (?, ?, ?, ?, ?, ?)`).bind(
        fullPhone, pin, uniqueid, session_id, getNowIso(), JSON.stringify({ xm1 })
      ).run()
      acc = await c.env.DB.prepare(`SELECT * FROM gopay_accounts WHERE phone = ?`).bind(fullPhone).first()
    }

    const authState = JSON.parse((acc as any).auth_state || '{}')
    const ssoBase = "https://accounts.goto-products.com"

    const methRes = await gojekFetch(c.env, ssoBase, "/goto-auth/login/methods", "POST", {
      client_id: CLIENT_ID, 
      client_secret: CLIENT_SECRET, 
      country_code: "+62", 
      phone_number: local, 
      email: "", 
      device_verification_token_id: ""
    }, "", (acc as any).uniqueid, (acc as any).session_id, authState.xm1)

    if (methRes.status === 429) return c.json({ error: "Terkena Rate Limit 429." }, 429)
    
    const vid = methRes.body?.data?.verification_id || ""
    if(!vid) throw new Error("Gagal mendapatkan verification_id");
    authState.vid = vid

    // Step 2: Initiate PIN 
    const initPin = await gojekFetch(c.env, ssoBase, "/cvs/v1/initiate", "POST", {
      client_id: CLIENT_ID, 
      client_secret: CLIENT_SECRET, 
      flow: "login_1fa", 
      verification_id: vid, 
      verification_method: "goto_pin", 
      is_multiple_method: true,
      country_code: "+62",
      phone_number: local
    }, "", (acc as any).uniqueid, (acc as any).session_id, authState.xm1)
    
    const challengeId = initPin.body?.data?.challenge_id || ""
    
    const pinRes = await gojekFetch(c.env, "https://customer.gopayapi.com", "/api/v1/users/pin/tokens/nb", "POST", {
      challenge_id: challengeId, client_id: "6d11d261d7ae462dbd4be0dc5f36a697-MFAGOJEK", pin: pin
    }, "", (acc as any).uniqueid, (acc as any).session_id, authState.xm1)

    const pinToken = pinRes.body?.data?.token || pinRes.body?.token || ""

    const cvsPin = await gojekFetch(c.env, ssoBase, "/cvs/v1/verify", "POST", {
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, flow: "login_1fa", verification_id: vid, verification_method: "goto_pin",
      data: { challenge_id: challengeId, validation_jwt: pinToken }
    }, "", (acc as any).uniqueid, (acc as any).session_id, authState.xm1)

    const vToken1fa = cvsPin.body?.data?.verification_token || ""
    
    const acctRes = await gojekFetch(c.env, ssoBase, "/goto-auth/accountlist", "POST", {
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET
    }, vToken1fa, (acc as any).uniqueid, (acc as any).session_id, authState.xm1)
    
    const accountId = acctRes.body?.data?.account_list?.[0]?.account_id || ""
    const token1fa = acctRes.body?.data?.["1fa_token"] || ""

    const t1Res = await gojekFetch(c.env, ssoBase, "/goto-auth/token", "POST", {
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "cvs", token: token1fa, account_id: accountId, scopes: []
    }, vToken1fa, (acc as any).uniqueid, (acc as any).session_id, authState.xm1)

    if (t1Res.status === 403) {
      const token2fa = t1Res.body?.data?.["2fa_token"] || ""
      const newVid = t1Res.body?.data?.verification_id || vid
      
      const otpRes = await gojekFetch(c.env, ssoBase, "/cvs/v1/initiate", "POST", {
          client_id: CLIENT_ID, 
          client_secret: CLIENT_SECRET, 
          flow: "login_2fa", 
          verification_id: newVid, 
          verification_method: channel,
          country_code: "+62",
          phone_number: local
      }, "", (acc as any).uniqueid, (acc as any).session_id, authState.xm1)

      authState.otpToken = otpRes.body?.data?.otp_token || ""
      authState.twofaToken = token2fa
      authState.accountId = accountId
      authState.vid = newVid
      
      await c.env.DB.prepare(`UPDATE gopay_accounts SET auth_state = ? WHERE phone = ?`).bind(JSON.stringify(authState), fullPhone).run()
      
      return c.json({ status: "awaiting_otp", message: `OTP telah dikirim via ${channel}` })
    }

    if (t1Res.status === 200 || t1Res.status === 201) {
      const accT = t1Res.body?.data?.access_token || ""
      const refT = t1Res.body?.data?.refresh_token || ""
      await c.env.DB.prepare(`UPDATE gopay_accounts SET access_token = ?, refresh_token = ? WHERE phone = ?`).bind(accT, refT, fullPhone).run()
      return c.json({ status: "success", message: "Login Berhasil tanpa OTP Tambahan!" })
    }

    throw new Error(`Respons tidak terduga pada Issue Token (Status: ${t1Res.status})`);
  } catch (err: any) {
    debugLog(c.env, 'GOPAY_CRITICAL_ERROR', err.message);
    return c.json({ error: "Sistem gagal memproses", details: err.message }, 500)
  }
})

gopayRouter.post('/verify-otp', async (c) => {
  // (Logika /verify-otp dipindah ke sini, isinya sama persis dengan sebelumnya)
  const { phone, otp, channel } = await c.req.json()
  const fullPhone = phone.startsWith("+62") ? phone : `+62${phone.replace(/^0/, '')}`
  
  try {
    const acc = await c.env.DB.prepare(`SELECT * FROM gopay_accounts WHERE phone = ?`).bind(fullPhone).first()
    if (!acc) return c.json({ error: "Sesi tidak ditemukan" }, 404)
    
    const authState = JSON.parse((acc as any).auth_state || '{}')
    const ssoBase = "https://accounts.goto-products.com"

    const verRes = await gojekFetch(c.env, ssoBase, "/cvs/v1/verify", "POST", {
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, flow: "login_2fa", verification_id: authState.vid, verification_method: channel,
      data: { otp: otp, otp_token: authState.otpToken }
    }, "", (acc as any).uniqueid, (acc as any).session_id, authState.xm1)

    if (![200, 201].includes(verRes.status)) return c.json({ error: "OTP Salah / Expired", details: verRes.body }, 400)

    const tFinal = await gojekFetch(c.env, ssoBase, "/goto-auth/token", "POST", {
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "challenge", token: authState.twofaToken, account_id: authState.accountId, scopes: []
    }, verRes.body?.data?.verification_token || "", (acc as any).uniqueid, (acc as any).session_id, authState.xm1)

    if ([200, 201].includes(tFinal.status)) {
      const accT = tFinal.body?.data?.access_token || ""
      const refT = tFinal.body?.data?.refresh_token || ""
      await c.env.DB.prepare(`UPDATE gopay_accounts SET access_token = ?, refresh_token = ? WHERE phone = ?`).bind(accT, refT, fullPhone).run()
      return c.json({ status: "success", message: "Berhasil Terhubung ke GoPay!" })
    }
    throw new Error(`Gagal Issue Token Final`);
  } catch (err: any) {
    return c.json({ error: "Sistem gagal memverifikasi OTP", details: err.message }, 500)
  }
})

export default gopayRouter
