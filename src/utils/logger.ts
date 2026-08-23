import { Bindings } from '../types'

export function debugLog(env: Bindings, processName: string, message: string, data: any = null) {
  if (env.DEBUG_MODE === "true") {
    const timestamp = new Date().toISOString();
    const logPrefix = `[${timestamp}] [${processName}] ${message}`;
    if (data) {
      const sanitizedData = JSON.parse(JSON.stringify(data));
      if (sanitizedData.pin) sanitizedData.pin = "***";
      if (sanitizedData.password) sanitizedData.password = "***";
      console.log(logPrefix, JSON.stringify(sanitizedData, null, 2));
    } else {
      console.log(logPrefix);
    }
  }
}
