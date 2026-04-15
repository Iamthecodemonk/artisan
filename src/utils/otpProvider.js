import { sendOtp as sendChampOtp, verifyOtp as sendChampVerify } from './sendchamp.js';
import * as twilio from './twilio.js';
import initFirebase from './firebaseAdmin.js';
import * as termii from './termii.js';

const PROVIDER = (process.env.OTP_PROVIDER || 'sendchamp').toLowerCase();

export async function sendOtp(to, code, options = {}) {
  if (PROVIDER === 'twilio') {
    return twilio.sendOtp(to, code, options);
  }
  if (PROVIDER === 'firebase') {
    // Firebase SMS OTPs are sent from the client-side SDK after reCAPTCHA
    // The backend cannot send SMS via Firebase Admin directly in a safe universal way.
    // Inform clients to use Firebase client SDK for sending and verification.
    return { success: true, info: 'use_firebase_client', message: 'Client should send SMS via Firebase SDK and then provide ID token to server for verification' };
  }
  if (PROVIDER === 'termii') {
    return termii.sendOtp(to, code, options);
  }

  // default to sendchamp — choose channel based on env flag
  try {
    const useSms = String(process.env.SENDCHAMP_USE_SMS || 'true').toLowerCase() === 'true';
    const channel = options.channel || (useSms ? 'sms' : 'whatsapp');
    return sendChampOtp(to, code, { ...options, channel });
  } catch (e) {
    return sendChampOtp(to, code, options);
  }
}

export async function verifyOtp(referenceOrTo, code) {
  if (PROVIDER === 'twilio') {
    // For Twilio Verify, we verify by `to` and `code`.
    return twilio.verifyOtp(referenceOrTo, code);
  }
  if (PROVIDER === 'firebase') {
    // For Firebase we expect `referenceOrTo` to be the ID token issued by the client
    const admin = initFirebase();
    if (!admin) return { success: false, error: 'firebase_not_configured' };
    try {
      const decoded = await admin.auth().verifyIdToken(String(referenceOrTo));
      return { success: true, status: 'verified', uid: decoded.uid, phone_number: decoded.phone_number, decoded };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
  if (PROVIDER === 'termii') {
    return termii.verifyOtp(referenceOrTo, code);
  }
  return sendChampVerify(referenceOrTo, code);
}

export default { sendOtp, verifyOtp };
