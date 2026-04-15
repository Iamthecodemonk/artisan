import twilio from 'twilio';
import crypto from 'crypto';
import RegistrationOtp from '../models/RegistrationOtp.js';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const FROM_NUMBER = process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER || '';
const VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || '';

const client = (ACCOUNT_SID && AUTH_TOKEN) ? twilio(ACCOUNT_SID, AUTH_TOKEN) : null;

export async function sendOtp(to, code, options = {}) {
  if (!client) return { success: false, message: 'TWILIO credentials not configured' };
  const toNumber = String(to).trim();
  try {
    if (VERIFY_SERVICE_SID) {
      const channel = options.channel === 'whatsapp' ? 'whatsapp' : 'sms';
      // use v2 Verify API to avoid deprecation warnings
      const res = await client.verify.v2.services(VERIFY_SERVICE_SID).verifications.create({ to: toNumber, channel });
      return { success: true, provider: 'twilio', method: 'verify', response: res };
    }

    if (!FROM_NUMBER) return { success: false, message: 'TWILIO_FROM not configured' };
    const body = options.message || `Your verification code is ${code}`;
    const res = await client.messages.create({ to: toNumber, from: FROM_NUMBER, body });
    return { success: true, provider: 'twilio', method: 'messages', response: res };
  } catch (err) {
    return { success: false, error: err?.message || err, status: err?.status };
  }
}

export async function verifyOtp(referenceOrTo, code) {
  if (!client) return { success: false, message: 'TWILIO credentials not configured' };
  try {
    if (VERIFY_SERVICE_SID) {
      const toNumber = String(referenceOrTo).trim();
      // use v2 Verify API
      const res = await client.verify.v2.services(VERIFY_SERVICE_SID).verificationChecks.create({ to: toNumber, code: String(code) });
      const ok = String(res.status).toLowerCase() === 'approved' || String(res.status).toLowerCase() === 'valid';
      return { success: ok, status: res.status, response: res };
    }

    // fallback: local RegistrationOtp check
    const toNumber = String(referenceOrTo).trim();
    const record = await RegistrationOtp.findOne({ $or: [{ 'payload.phone': toNumber }, { 'payload.phoneNumber': toNumber }, { 'delivered.to': toNumber }] });
    if (!record) return { success: false, message: 'No OTP record found for number' };
    const codeHash = crypto.createHash('sha256').update(String(code)).digest('hex');
    return { success: codeHash === record.codeHash };
  } catch (err) {
    return { success: false, error: err?.message || err, status: err?.status };
  }
}

export default { sendOtp, verifyOtp };