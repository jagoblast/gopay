import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { Bindings } from '../types'
import { debugLog } from './logger'

export const CLIENT_ID = "gojek:consumer:app"
export const CLIENT_SECRET = "pGwQ7oi8bKqqwvid09UrjqpkMEHklb"
export const D1_CERT = "CF:43:60:94:46:9C:A0:8F:CB:5C:95:05:97:E9:03:51:40:0A:C7:33:EC:BA:40:71:F1:94:DC:CE:BA:AE:4C:A8"

export function generateXm1(installTs: number, installRand: string, mac: string) {
  const ts = Math.floor(Date.now() / 1000)
  return `1:UNKNOWN,2:UNKNOWN,3:${installTs}-${installRand},4:131072,5:kalama|3360|8,6:${mac},7:<unknown ssid>,8:1080x2340,9:passive\\,fused\\,gps,10:0,11:dummy_drm,12:VKEY_DISABLED,13:1003,14:${ts},16:0,17:1`
}

export function signV2Gojek(token: string, urlPath: string, method: string, bodyStr: string, uniqueid: string, xm1: string) {
  const ts = Date.now().toString()
  const bodyHash = createHash('md5').update(bodyStr).digest('hex')
  const nonce = randomBytes(40).toString('hex')
  
  const tokenVal = token.startsWith("Bearer ") ? token.slice(7) : token
  const msg = `;google,sdk_gphone64_x86_64:${tokenVal};${uniqueid}:${D1_CERT};${bodyHash}:${urlPath};${method}:${ts};Android,13:5.60.1;${xm1}:com.gojek.app;${nonce}:Google;Android`
  
  const key = Buffer.from("5b4c2c7453702f2a6b372b2326354e416c312648757c4c4c233569566131545978475e634e2d79747455215649745d627946716474763f4e4a264b377c674500", "hex")
  const hmacHex = createHmac('sha256', key).update(msg).digest('hex')
  
  return {
    "X-E1": `${hmacHex}:${nonce}:N:${ts}`,
    "X-E2": "57AA34CFE51221492EDADA791BBB9",
    "X-E3": bodyHash,
    "X-M1": xm1,
    "AdjTs": "ts:A"
  }
}

export async function gojekFetch(env: Bindings, baseUrl: string, path: string, method: string, bodyObj: any, token: string, uniqueid: string, sessionId: string, xm1: string) {
  const reqId = randomUUID().split('-')[0];
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : ""
  const sigs = signV2Gojek(token, `${baseUrl.replace('https://', '')}${path}`, method, bodyStr, uniqueid, xm1)
  
  const headers: Record<string, string> = {
    "User-Agent": "Gojek/5.60.1 (com.gojek.app; build:5602; Android,13)",
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-AppVersion": "5.60.1",
    "X-AppId": "com.gojek.app",
    "X-UniqueId": uniqueid,
    "X-Session-ID": sessionId,
    "X-Platform": "Android",
    "X-DeviceOS": "Android,13",
    "X-PhoneMake": "Google",
    "X-PhoneModel": "google,sdk_gphone64_x86_64",
    "D1": D1_CERT,
    
    "X-User-Type": "customer",
    "X-AuthSDK-Version": "3.103.0",
    "X-CVSDK-Version": "3.73.0",
    "Transaction-ID": randomUUID(),
    
    ...sigs
  }
  
  if (token) headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`
  
  const reqInit: RequestInit = { method, headers }
  if (bodyStr) reqInit.body = bodyStr

  debugLog(env, `GOJEK_REQ_${reqId}`, `${method} ${baseUrl}${path}`, { body: bodyObj });

  const res = await fetch(`${baseUrl}${path}`, reqInit)
  const text = await res.text()
  
  let responseBody;
  try {
    responseBody = JSON.parse(text)
  } catch(e) {
    responseBody = { raw: text }
  }

  debugLog(env, `GOJEK_RES_${reqId}`, `Status HTTP: ${res.status}`, responseBody);

  return { status: res.status, body: responseBody }
}

export async function requestOtpHandler(request: Request, env: Bindings) {
  try {
    let reqBody: any = {};
    try {
      reqBody = await request.json();
    } catch (e) {
      // Abaikan jika tidak ada body
    }

    // PENGAMAN SPASI: String(...).trim() akan memastikan nomor " 8777..." berubah menjadi "8777..."
    const phoneNumber = String(reqBody.phone_number || "85559155797").trim();
    const pin = String(reqBody.pin || "415678").trim();
    const countryCode = String(reqBody.country_code || "+62").trim();

    const uniqueId = randomUUID();
    const sessionId = randomUUID();
    const installTs = Math.floor(Date.now() / 1000) - (86400 * 30);
    const installRand = randomUUID().split('-')[0];
    const mac = "02:00:00:00:00:00";
    const xm1 = generateXm1(installTs, installRand, mac);
    
    const baseUrl = "https://accounts.goto-products.com";
    const gopayUrl = "https://customer.gopayapi.com";

    debugLog(env, "GOPAY_REQ_OTP", `Memulai proses untuk: ${countryCode}${phoneNumber} via otp_sms`);

    // TAHAP 1
    const bodyMethods = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      country_code: countryCode,
      phone_number: phoneNumber,
      email: "",
      device_verification_token_id: ""
    };
    const methodsRes = await gojekFetch(env, baseUrl, '/goto-auth/login/methods', 'POST', bodyMethods, "", uniqueId, sessionId, xm1);
    if (methodsRes.status >= 400) {
      return new Response(JSON.stringify({ success: false, message: "Gagal mendapatkan metode login", gojek_response: methodsRes.body }), { status: methodsRes.status });
    }
    const verificationId = methodsRes.body?.data?.verification_id;
    if (!verificationId) {
      return new Response(JSON.stringify({ success: false, message: "verification_id tidak ditemukan" }), { status: 500 });
    }

    // TAHAP 2
    const bodyInit = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      flow: "login_1fa",
      verification_id: verificationId,
      verification_method: "goto_pin",
      is_multiple_method: true,
      country_code: countryCode,
      phone_number: phoneNumber
    };
    const initRes = await gojekFetch(env, baseUrl, '/cvs/v1/initiate', 'POST', bodyInit, "", uniqueId, sessionId, xm1);
    if (initRes.status >= 400) {
      return new Response(JSON.stringify({ success: false, message: "Gagal menginisiasi login. Parameter mungkin tidak valid.", gojek_response: initRes.body }), { status: initRes.status });
    }
    const challengeId = initRes.body?.data?.challenge_id;

    // TAHAP 3
    const bodyPin = {
      challenge_id: challengeId,
      client_id: "6d11d261d7ae462dbd4be0dc5f36a697-MFAGOJEK",
      pin: pin
    };
    const pinRes = await gojekFetch(env, gopayUrl, '/api/v1/users/pin/tokens/nb', 'POST', bodyPin, "", uniqueId, sessionId, xm1);
    if (pinRes.status >= 400) {
      return new Response(JSON.stringify({ success: false, message: "PIN salah atau ditolak", gojek_response: pinRes.body }), { status: pinRes.status });
    }
    const validationJwt = pinRes.body?.data?.validation_jwt || pinRes.body?.validation_jwt || "";

    // TAHAP 4
    const bodyVerify = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      flow: "login_1fa",
      verification_id: verificationId,
      verification_method: "goto_pin",
      data: {
        challenge_id: challengeId,
        validation_jwt: validationJwt
      }
    };
    const verifyRes = await gojekFetch(env, baseUrl, '/cvs/v1/verify', 'POST', bodyVerify, "", uniqueId, sessionId, xm1);
    if (verifyRes.status >= 400) {
      return new Response(JSON.stringify({ success: false, message: "Verifikasi CVS gagal", gojek_response: verifyRes.body }), { status: verifyRes.status });
    }
    const cvsToken = verifyRes.body?.data?.token || "";

    // TAHAP 5
    const bodyAccountList = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    };
    const accountListRes = await gojekFetch(env, baseUrl, '/goto-auth/accountlist', 'POST', bodyAccountList, cvsToken, uniqueId, sessionId, xm1);
    if (accountListRes.status >= 400) {
      return new Response(JSON.stringify({ success: false, message: "Gagal mengambil Account List", gojek_response: accountListRes.body }), { status: accountListRes.status });
    }
    const accountId = accountListRes.body?.data?.[0]?.account_id || "";

    // TAHAP 6
    const bodyToken = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "cvs",
      token: cvsToken,
      account_id: accountId,
      scopes: []
    };
    const tokenRes = await gojekFetch(env, baseUrl, '/goto-auth/token', 'POST', bodyToken, "", uniqueId, sessionId, xm1);
    if (tokenRes.status >= 400) {
      debugLog(env, "GOPAY_CRITICAL_ERROR", `Respons tidak terduga pada Issue Token (Status: ${tokenRes.status})`);
      return new Response(JSON.stringify({ success: false, message: "Gagal mendapatkan Final Token", gojek_response: tokenRes.body }), { status: tokenRes.status });
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Login berhasil",
      data: tokenRes.body
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error: any) {
    debugLog(env, "GOPAY_CRITICAL_ERROR", `Unhandled Exception: ${error.message}`);
    return new Response(JSON.stringify({
      success: false,
      message: "Terjadi kesalahan internal pada Worker",
      error: error.message
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
