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
    "user-type": "customer",
    "D1": D1_CERT,
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
