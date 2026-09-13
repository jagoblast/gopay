import { Bindings } from '../types'
import { debugLog } from './logger'
// Pastikan path import di bawah ini disesuaikan dengan nama file utility Anda
import { gojekFetch, CLIENT_ID, CLIENT_SECRET, generateXm1 } from './gojek-utils' 

export async function requestOtpHandler(request: Request, env: Bindings) {
  try {
    // 1. Ambil payload dari request aplikasi Anda
    let reqBody: any = {};
    try {
      reqBody = await request.json();
    } catch (e) {
      // Abaikan jika tidak ada body, gunakan fallback statis untuk pengujian
    }

    const phoneNumber = reqBody.phone_number || "85559155797";
    const pin = reqBody.pin || "415678";
    const countryCode = reqBody.country_code || "+62";

    // Setup session & meta data 
    const uniqueId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const installTs = Math.floor(Date.now() / 1000) - (86400 * 30); // 30 hari lalu
    const installRand = crypto.randomUUID().split('-')[0];
    const mac = "02:00:00:00:00:00";
    const xm1 = generateXm1(installTs, installRand, mac);
    
    const baseUrl = "https://accounts.goto-products.com";
    const gopayUrl = "https://customer.gopayapi.com";

    debugLog(env, "GOPAY_REQ_OTP", `Memulai proses untuk: ${countryCode}${phoneNumber} via otp_sms`);

    // ==========================================
    // TAHAP 1: GET LOGIN METHODS
    // ==========================================
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
      return new Response(JSON.stringify({ success: false, message: "verification_id tidak ditemukan dari response Gojek" }), { status: 500 });
    }


    // ==========================================
    // TAHAP 2: INITIATE LOGIN (1FA)
    // ==========================================
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

    // 🛑 ERROR HANDLING: Jika inisiasi gagal (seperti error 400 di log Anda), STOP di sini!
    if (initRes.status >= 400) {
      return new Response(JSON.stringify({ success: false, message: "Gagal menginisiasi login. Parameter mungkin tidak valid.", gojek_response: initRes.body }), { status: initRes.status });
    }

    const challengeId = initRes.body?.data?.challenge_id;


    // ==========================================
    // TAHAP 3: VERIFY PIN GOPAY
    // ==========================================
    const bodyPin = {
      challenge_id: challengeId,
      client_id: "6d11d261d7ae462dbd4be0dc5f36a697-MFAGOJEK",
      pin: pin
    };

    const pinRes = await gojekFetch(env, gopayUrl, '/api/v1/users/pin/tokens/nb', 'POST', bodyPin, "", uniqueId, sessionId, xm1);

    if (pinRes.status >= 400) {
      return new Response(JSON.stringify({ success: false, message: "PIN salah atau ditolak oleh GoPay", gojek_response: pinRes.body }), { status: pinRes.status });
    }

    // Tergantung pada struktur response Gojek, ini biasanya berisi token jwt validasi
    const validationJwt = pinRes.body?.data?.validation_jwt || pinRes.body?.validation_jwt || "";


    // ==========================================
    // TAHAP 4: VERIFY CVS
    // ==========================================
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

    // Gojek biasanya mengembalikan token sementara (temp token) setelah verify
    const cvsToken = verifyRes.body?.data?.token || "";


    // ==========================================
    // TAHAP 5: GET ACCOUNT LIST
    // ==========================================
    const bodyAccountList = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    };

    // PENTING: cvsToken disisipkan di sini agar tidak error 401 "missing auth header"
    const accountListRes = await gojekFetch(env, baseUrl, '/goto-auth/accountlist', 'POST', bodyAccountList, cvsToken, uniqueId, sessionId, xm1);

    if (accountListRes.status >= 400) {
      return new Response(JSON.stringify({ success: false, message: "Gagal mengambil Account List", gojek_response: accountListRes.body }), { status: accountListRes.status });
    }

    const accountId = accountListRes.body?.data?.[0]?.account_id || "";


    // ==========================================
    // TAHAP 6: ISSUE FINAL TOKEN
    // ==========================================
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

    // ==========================================
    // SUKSES - KEMBALIKAN TOKEN KE APLIKASI
    // ==========================================
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
