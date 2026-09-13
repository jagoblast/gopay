import { Hono } from 'hono'
import { randomBytes, randomUUID } from 'node:crypto'
import { Bindings } from '../types'
import { debugLog } from '../utils/logger'
import { generateXm1, gojekFetch, CLIENT_ID, CLIENT_SECRET } from '../utils/gojek'

const gopayRouter = new Hono<{ Bindings: Bindings }>()
const getNowIso = () => new Date().toISOString()

gopayRouter.post('/request-otp', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))
    
    const rawPhone = String(body.phone || "").trim()
    const pin = String(body.pin || "").trim()
    const channel = String(body.channel || "otp_sms").trim()

    const local = rawPhone.replace('+62', '').replace(/^0/, '')
    const fullPhone = `+62${local}`
    
    debugLog(c.env, 'GOPAY_REQ_OTP', `Memulai proses untuk: ${fullPhone} via ${channel}`);

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
    const uniqueId = (acc as any).uniqueid;
    const sessionId = (acc as any).session_id;

    // ==========================================
    // TAHAP 1: Get Methods
    // ==========================================
    const methRes = await gojekFetch(c.env, ssoBase, "/goto-auth/login/methods", "POST", {
      client_id: CLIENT_ID, 
      client_secret: CLIENT_SECRET, 
      country_code: "+62", 
      phone_number: local, 
      email: "", 
      device_verification_token_id: ""
    }, "", uniqueId, sessionId, authState.xm1)

    if (methRes.status === 429) {
      return c.json({ success: false, error: "Terlalu banyak percobaan (Rate Limit). Tunggu 60 menit." }, 429)
    } else if (methRes.status >= 400) {
      return c.json({ success: false, error: "Gagal mendapatkan metode login", details: methRes.body }, methRes.status)
    }
    
    const vid = methRes.body?.data?.verification_id || ""
    if(!vid) throw new Error("Gagal mendapatkan verification_id");
    
    const availableMethods: string[] = methRes.body?.data?.methods || [];
    
    // LOGIKA DINAMIS: Cek apakah akun ini diizinkan pakai PIN dan user mengirimkan PIN
    const usePinFlow = availableMethods.includes("goto_pin") && pin.length > 0;

    if (usePinFlow) {
      // ==========================================
      // ALUR A: LOGIN VIA PIN (Jika tersedia)
      // ==========================================
      debugLog(c.env, 'GOPAY_INFO', `Menggunakan alur PIN (goto_pin)`);
      
      const initPin = await gojekFetch(c.env, ssoBase, "/cvs/v1/initiate", "POST", {
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, flow: "login_1fa", verification_id: vid, verification_method: "goto_pin", is_multiple_method: true, country_code: "+62", phone_number: local
      }, "", uniqueId, sessionId, authState.xm1)
      
      if (initPin.status >= 400) return c.json({ success: false, error: "Gagal inisiasi PIN.", details: initPin.body }, initPin.status)

      const challengeId = initPin.body?.data?.challenge_id || ""
      
      const pinRes = await gojekFetch(c.env, "https://customer.gopayapi.com", "/api/v1/users/pin/tokens/nb", "POST", {
        challenge_id: challengeId, client_id: "6d11d261d7ae462dbd4be0dc5f36a697-MFAGOJEK", pin: pin
      }, "", uniqueId, sessionId, authState.xm1)

      if (pinRes.status >= 400) return c.json({ success: false, error: "PIN salah atau ditolak", details: pinRes.body }, pinRes.status)

      const pinToken = pinRes.body?.data?.token || pinRes.body?.token || pinRes.body?.data?.validation_jwt || pinRes.body?.validation_jwt || ""

      const cvsPin = await gojekFetch(c.env, ssoBase, "/cvs/v1/verify", "POST", {
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, flow: "login_1fa", verification_id: vid, verification_method: "goto_pin",
        data: { challenge_id: challengeId, validation_jwt: pinToken }
      }, "", uniqueId, sessionId, authState.xm1)

      if (cvsPin.status >= 400) return c.json({ success: false, error: "Verifikasi CVS gagal", details: cvsPin.body }, cvsPin.status)

      const vToken1fa = cvsPin.body?.data?.verification_token || ""
      
      const acctRes = await gojekFetch(c.env, ssoBase, "/goto-auth/accountlist", "POST", {
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET
      }, vToken1fa, uniqueId, sessionId, authState.xm1)
      
      if (acctRes.status >= 400) return c.json({ success: false, error: "Gagal mengambil Account List", details: acctRes.body }, acctRes.status)

      const accountId = acctRes.body?.data?.account_list?.[0]?.account_id || acctRes.body?.data?.[0]?.account_id || ""
      const token1fa = acctRes.body?.data?.["1fa_token"] || vToken1fa

      const t1Res = await gojekFetch(c.env, ssoBase, "/goto-auth/token", "POST", {
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "cvs", token: token1fa, account_id: accountId, scopes: []
      }, vToken1fa, uniqueId, sessionId, authState.xm1)

      if (t1Res.status === 403) {
        const token2fa = t1Res.body?.data?.["2fa_token"] || ""
        const newVid = t1Res.body?.data?.verification_id || vid
        
        const otpRes = await gojekFetch(c.env, ssoBase, "/cvs/v1/initiate", "POST", {
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET, flow: "login_2fa", verification_id: newVid, verification_method: channel, country_code: "+62", phone_number: local
        }, "", uniqueId, sessionId, authState.xm1)

        if (otpRes.status >= 400) return c.json({ success: false, error: `Gagal meminta OTP via ${channel}`, details: otpRes.body }, otpRes.status)

        authState.loginFlow = "login_2fa"
        authState.otpToken = otpRes.body?.data?.otp_token || ""
        authState.twofaToken = token2fa
        authState.accountId = accountId
        authState.vid = newVid
        
        await c.env.DB.prepare(`UPDATE gopay_accounts SET auth_state = ? WHERE phone = ?`).bind(JSON.stringify(authState), fullPhone).run()
        return c.json({ success: true, status: "awaiting_otp", message: `OTP dikirim via ${channel} (Setelah verifikasi PIN)` })
      }

      if (t1Res.status === 200 || t1Res.status === 201) {
        const accT = t1Res.body?.data?.access_token || ""
        const refT = t1Res.body?.data?.refresh_token || ""
        await c.env.DB.prepare(`UPDATE gopay_accounts SET access_token = ?, refresh_token = ? WHERE phone = ?`).bind(accT, refT, fullPhone).run()
        return c.json({ success: true, status: "success", message: "Login Berhasil tanpa OTP Tambahan!" })
      }

      return c.json({ success: false, error: "Gagal mendapatkan Final Token", details: t1Res.body }, t1Res.status)

    } else {
      // ==========================================
      // ALUR B: LOGIN TANPA PIN (OTP Langsung / 1FA)
      // ==========================================
      debugLog(c.env, 'GOPAY_INFO', `Menggunakan alur TANPA PIN (${channel})`);

      const otpInit = await gojekFetch(c.env, ssoBase, "/cvs/v1/initiate", "POST", {
        client_id: CLIENT_ID, 
        client_secret: CLIENT_SECRET, 
        flow: "login_1fa", 
        verification_id: vid, 
        verification_method: channel, 
        country_code: "+62",
        phone_number: local
      }, "", uniqueId, sessionId, authState.xm1)

      if (otpInit.status >= 400) {
        return c.json({ success: false, error: `Gagal inisiasi OTP via ${channel}. Parameter mungkin invalid.`, details: otpInit.body }, otpInit.status)
      }

      authState.loginFlow = "login_1fa"
      authState.vid = vid
      authState.otpToken = otpInit.body?.data?.otp_token || ""
      
      await c.env.DB.prepare(`UPDATE gopay_accounts SET auth_state = ? WHERE phone = ?`).bind(JSON.stringify(authState), fullPhone).run()
      return c.json({ success: true, status: "awaiting_otp", message: `OTP telah dikirim via ${channel} (Bypass PIN)` })
    }

  } catch (err: any) {
    debugLog(c.env, 'GOPAY_CRITICAL_ERROR', err.message);
    return c.json({ success: false, error: "Sistem gagal memproses", details: err.message }, 500)
  }
})


gopayRouter.post('/verify-otp', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))
    const rawPhone = String(body.phone || "").trim()
    const otp = String(body.otp || "").trim()
    const channel = String(body.channel || "otp_sms").trim()

    const fullPhone = rawPhone.startsWith("+62") ? rawPhone : `+62${rawPhone.replace(/^0/, '')}`
  
    const acc = await c.env.DB.prepare(`SELECT * FROM gopay_accounts WHERE phone = ?`).bind(fullPhone).first()
    if (!acc) return c.json({ success: false, error: "Sesi tidak ditemukan" }, 404)
    
    const authState = JSON.parse((acc as any).auth_state || '{}')
    const ssoBase = "https://accounts.goto-products.com"
    const uniqueId = (acc as any).uniqueid;
    const sessionId = (acc as any).session_id;

    // Mendeteksi apakah ini verifikasi OTP untuk 1FA (tanpa PIN) atau 2FA (setelah PIN)
    const loginFlow = authState.loginFlow || "login_2fa";

    const verRes = await gojekFetch(c.env, ssoBase, "/cvs/v1/verify", "POST", {
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, flow: loginFlow, verification_id: authState.vid, verification_method: channel,
      data: { otp: otp, otp_token: authState.otpToken }
    }, "", uniqueId, sessionId, authState.xm1)

    if (verRes.status >= 400) {
      return c.json({ success: false, error: "OTP Salah atau Kadaluarsa", details: verRes.body }, verRes.status)
    }

    const vToken = verRes.body?.data?.verification_token || ""
    let accT = "";
    let refT = "";

    if (loginFlow === "login_1fa") {
      // Jika bypass PIN, setelah validasi OTP kita harus ambil AccountList lalu Issue Token
      const acctRes = await gojekFetch(c.env, ssoBase, "/goto-auth/accountlist", "POST", {
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET
      }, vToken, uniqueId, sessionId, authState.xm1)
      
      if (acctRes.status >= 400) return c.json({ success: false, error: "Gagal mengambil Account List setelah OTP", details: acctRes.body }, acctRes.status)

      const accountId = acctRes.body?.data?.account_list?.[0]?.account_id || acctRes.body?.data?.[0]?.account_id || ""
      const token1fa = acctRes.body?.data?.["1fa_token"] || vToken

      const t1Res = await gojekFetch(c.env, ssoBase, "/goto-auth/token", "POST", {
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "cvs", token: token1fa, account_id: accountId, scopes: []
      }, vToken, uniqueId, sessionId, authState.xm1)

      if (t1Res.status >= 400) return c.json({ success: false, error: "Gagal Issue Token 1FA", details: t1Res.body }, t1Res.status)

      accT = t1Res.body?.data?.access_token || ""
      refT = t1Res.body?.data?.refresh_token || ""

    } else {
      // Jika melewati PIN (2FA flow), validasi final menggunakan challenge token
      const tFinal = await gojekFetch(c.env, ssoBase, "/goto-auth/token", "POST", {
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "challenge", token: authState.twofaToken, account_id: authState.accountId, scopes: []
      }, vToken, uniqueId, sessionId, authState.xm1)

      if (tFinal.status >= 400) return c.json({ success: false, error: "Gagal validasi Token Final 2FA", details: tFinal.body }, tFinal.status)

      accT = tFinal.body?.data?.access_token || ""
      refT = tFinal.body?.data?.refresh_token || ""
    }

    await c.env.DB.prepare(`UPDATE gopay_accounts SET access_token = ?, refresh_token = ? WHERE phone = ?`).bind(accT, refT, fullPhone).run()
    return c.json({ success: true, status: "success", message: "Berhasil Terhubung ke GoPay!" })

  } catch (err: any) {
    return c.json({ success: false, error: "Sistem gagal memverifikasi OTP", details: err.message }, 500)
  }
})

export default gopayRouter
