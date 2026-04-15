import admin from 'firebase-admin';
import fs from 'fs';

let initialized = false;

export default function initFirebase() {
  if (initialized) return admin;

  const keyBase64 = process.env.SERVICE_ACCOUNT_KEY_BASE64;
  const keyPath = process.env.SERVICE_ACCOUNT_PATH;
  let credentialObj = null;

  if (keyBase64) {
    try {
      credentialObj = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf8'));
    } catch (e) {
      throw new Error('Invalid SERVICE_ACCOUNT_KEY_BASE64');
    }
  } else if (keyPath && fs.existsSync(keyPath)) {
    try {
      credentialObj = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    } catch (e) {
      throw new Error('Invalid SERVICE_ACCOUNT_PATH content');
    }
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // let firebase use default credentials if set in environment
    // admin will read GOOGLE_APPLICATION_CREDENTIALS automatically
  } else {
    // Not configured; do not initialize
    return null;
  }

  try {
    if (credentialObj) {
      admin.initializeApp({ credential: admin.credential.cert(credentialObj) });
    } else {
      admin.initializeApp();
    }
    initialized = true;
    return admin;
  } catch (e) {
    throw e;
  }
}
