import axios from 'axios';
import util from 'util';

const API_BASE = 'https://api.sendchamp.com/api/v1';

function maskToken(t) {
  try {
    if (!t) return null;
    const s = String(t);
    if (s.length <= 4) return '****';
    return '****' + s.slice(-2) + ` (len=${s.length})`;
  } catch (e) { return null; }
}

async function initHeaders() {
  const key = process.env.SENDCHAMP_API_KEY || process.env.SENDCHAMP_KEY;
  if (!key) return null;
  try {
    // Basic sanity check: API keys typically have a prefix like "SC." and a reasonable length
    if (typeof key === 'string' && (key.indexOf('SC.') === 0 || key.indexOf('sc.') === 0) && key.length < 40) {
      console.warn('SENDCHAMP_API_KEY looks short/truncated (length=' + key.length + ')');
    }
  } catch (e) {
    /* ignore */
  }
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export async function sendSms(to, message) {
  try {
    const headers = await initHeaders();
    if (!headers) return { success: false, message: 'SENDCHAMP_API_KEY not configured' };
    const payload = { to: String(to), message: String(message) };
    const res = await axios.post(`${API_BASE}/sms/send`, payload, { headers });
    const body = res?.data || {};
    if (body && (body.status === 'success' || body.success === true || res.status === 200)) {
      return { success: true, data: body };
    }
    return { success: false, status: res.status, error: body || 'Unknown provider response', data: body };
  } catch (err) {
    return { success: false, status: err?.response?.status, error: err?.response?.data || err?.message || String(err) };
  }
}

export async function sendEmail(to, subject, html, from) {
  try {
    const headers = await initHeaders();
    if (!headers) return { success: false, message: 'SENDCHAMP_API_KEY not configured' };
    // normalize `to` into array of recipient objects expected by SendChamp
    let toArray;
    if (Array.isArray(to)) {
      toArray = to.map(t => (typeof t === 'string' ? { email: t } : t));
    } else if (typeof to === 'string') {
      toArray = [{ email: to }];
    } else if (to && typeof to === 'object') {
      toArray = [to];
    } else {
      return { success: false, message: 'invalid recipient for sendchamp email' };
    }

    const payload = {
      to: toArray,
      subject: String(subject),
      html: html || '',
      senderName: process.env.SENDCHAMP_DEFAULT_SENDER || from || 'Artisan',
      sender: from || process.env.SENDCHAMP_SENDER_EMAIL || process.env.SMTP_FROM || 'no-reply@yourdomain.com',
    };
    const res = await axios.post(`${API_BASE}/email/send`, payload, { headers });
    const body = res?.data || {};
    if (body && (body.status === 'success' || body.success === true || res.status === 200)) {
      return { success: true, data: body };
    }
    return { success: false, status: res.status, error: body || 'Unknown provider response', data: body };
  } catch (err) {
    return { success: false, status: err?.response?.status, error: err?.response?.data || err?.message || String(err) };
  }
}

// Send OTP using SendChamp OTP API when available. Tries several common OTP endpoints
export async function sendOtp(to, code, options = {}) {
  const attempted = [];
  try {
    const headers = await initHeaders();
    if (!headers) return { success: false, message: 'SENDCHAMP_API_KEY not configured' };

    // Build primary /verification/create payload according to OpenAPI spec
    const channel = (options.channel || 'sms').toString();
    // const sender = options.sender || process.env.SENDCHAMP_DEFAULT_SENDER || (channel === 'sms' ? (process.env.SENDCHAMP_SMS_SENDER || 'ChampOTP') : '');
    const sender = 'ChampOTP';
    const token = options.token || String(code || '');
    const token_type = options.token_type || (/^[0-9]+$/.test(token) ? 'numeric' : 'alphanumeric');
    const token_length = options.token_length || (token.length || 6);
    const expiration_time = typeof options.expiration_time === 'number' ? options.expiration_time : (options.ttl ? Math.ceil((options.ttl || 900) / 60) : 15);
    const meta_data = options.meta_data || (options.first_name ? { first_name: options.first_name } : {});

    const body = {
      channel,
      sender,
      token_type,
      token_length,
      expiration_time,
      meta_data: Object.keys(meta_data).length ? meta_data : undefined,
    };

    if (channel === 'email' || options.email || /@/.test(String(to))) {
      body.customer_email_address = options.email || String(to);
    } else {
      body.customer_mobile_number = String(to);
    }

    if (token) body.token = token;

    // Handle WhatsApp Template messages: SendChamp expects a different payload
    if (channel === 'whatsapp') {
      try {
        const template = options.template || process.env.SENDCHAMP_WHATSAPP_TEMPLATE || process.env.SENDCHAMP_WHATSAPP_TEMPLATE_CODE || 'rijhub_registration';
        const senderWhats = options.sender || process.env.SENDCHAMP_WHATSAPP_SENDER || process.env.SENDCHAMP_DEFAULT_SENDER || '';
        const custom_data = {};
        // Map the OTP to the first template variable ({{1}})
        custom_data['1'] = String(token || '');

        const waBody = {
          recipient: String(to),
          sender: senderWhats,
          template_code: template,
          type: 'template',
          custom_data,
        };

        const url = `${API_BASE}/whatsapp/message/send`;
        attempted.push(url);
        // console.log('sendchamp: whatsapp TEMPLATE POST', url, { recipient: waBody.recipient, sender: senderWhats, template: template, token: maskToken(custom_data['1']) });
        const res = await axios.post(url, waBody, { headers });
        // console.log('sendchamp: whatsapp response', { url, status: res.status, data: res.data });
        return { success: true, provider: 'sendchamp', method: 'whatsapp', url, response: res.data, attempted };
      } catch (waErr) {
        attempted.push({ url: `${API_BASE}/whatsapp/message/send`, status: waErr?.response?.status, error: waErr?.response?.data || waErr?.message });
        console.error('sendchamp: whatsapp/template error', { url: `${API_BASE}/whatsapp/message/send`, status: waErr?.response?.status, error: waErr?.response?.data || waErr?.message });
        // continue to fallbacks
      }
    }

    // Attempt primary endpoint
    try {
      const url = `${API_BASE}/verification/create`;
      attempted.push(url);
      console.log('sendchamp: POST', url, { channel: body.channel, sender: body.sender, token: maskToken(body.token), token_type: body.token_type, token_length: body.token_length, expiration_time: body.expiration_time });
      const res = await axios.post(url, body, { headers });
      console.log('sendchamp: response', { url, status: res.status, data: util.inspect(res.data, { depth: null }) });
      return { success: true, provider: 'sendchamp', url, response: res.data };
    } catch (errPrimary) {
      attempted.push({ url: `${API_BASE}/verification/create`, status: errPrimary?.response?.status, error: errPrimary?.response?.data || errPrimary?.message });
      console.error('sendchamp: verification/create error', { url: `${API_BASE}/verification/create`, status: errPrimary?.response?.status, error: errPrimary?.response?.data || errPrimary?.message });
    }

    // Fallbacks: try OTP-specific or SMS/Email send endpoints
    const fallbacks = [];
    fallbacks.push({ url: `${API_BASE}/otp/send`, body: { phone: String(to), code: token, ttl: (options.ttl || 900) } });
    fallbacks.push({ url: `${API_BASE}/otp/send-otp`, body: { to: String(to), code: token, expiry: (options.ttl || 900) } });
    fallbacks.push({ url: `${API_BASE}/otp`, body: { to: String(to), code: token } });
    const smsSender = process.env.SENDCHAMP_SMS_SENDER || 'ChampOTP';
    fallbacks.push({ url: `${API_BASE}/sms/send`, body: { to: String(to), message: `Your verification code is ${token}`, sender: smsSender } });
    // email fallback: ensure `to` is array and include senderName
    let fbTo;
    if (Array.isArray(to)) {
      fbTo = to.map(t => (typeof t === 'string' ? { email: t } : t));
    } else if (typeof to === 'string') {
      fbTo = [{ email: to }];
    } else if (to && typeof to === 'object') {
      fbTo = [to];
    } else {
      fbTo = [];
    }

    fallbacks.push({ url: `${API_BASE}/email/send`, body: { to: fbTo, subject: options.subject || 'Verification code', html: options.html || `Your verification code is ${token}`, senderName: process.env.SENDCHAMP_DEFAULT_SENDER || options.senderName || 'Artisan', sender: options.from || process.env.SENDCHAMP_SENDER_EMAIL || process.env.SMTP_FROM } });

    for (const fb of fallbacks) {
      try {
        attempted.push(fb.url);
        console.log('sendchamp: FALLBACK POST', fb.url, { body: { ...fb.body, code: maskToken(fb.body.code || fb.body.token) } });
        const res = await axios.post(fb.url, fb.body, { headers });
        console.log('sendchamp: FALLBACK response', { url: fb.url, status: res.status, data: util.inspect(res.data, { depth: null }) });
        if (res && res.data) return { success: true, provider: 'sendchamp', url: fb.url, response: res.data, attempted };
      } catch (e) {
        attempted.push({ url: fb.url, status: e?.response?.status, error: e?.response?.data || e?.message });
        console.error('sendchamp: fallback error', { url: fb.url, status: e?.response?.status, error: e?.response?.data || e?.message });
      }
    }

    return { success: false, message: 'All SendChamp endpoints failed', attempted };
  } catch (err) {
    return { success: false, status: err?.response?.status, error: err?.response?.data || err?.message || String(err) };
  }
}

// Verify OTP using SendChamp verification/confirm endpoint
export async function verifyOtp(reference, code) {
  try {
    const headers = await initHeaders();
    if (!headers) return { success: false, message: 'SENDCHAMP_API_KEY not configured' };
    if (!reference) return { success: false, message: 'reference required' };
    const url = `${API_BASE}/verification/confirm`;
    const body = { verification_reference: String(reference), verification_code: String(code) };
    console.log('sendchamp: verify POST', url, { reference: String(reference), code: maskToken(code) });
    const res = await axios.post(url, body, { headers });
    console.log('sendchamp: verify response', { url, status: res.status, data: res.data });
    return { success: true, provider: 'sendchamp', url, response: res.data };
  } catch (err) {
    console.error('sendchamp: verify error', { status: err?.response?.status, error: err?.response?.data || err?.message || String(err) });
    return { success: false, status: err?.response?.status, error: err?.response?.data || err?.message || String(err) };
  }
}

export default { sendSms, sendEmail, sendOtp, verifyOtp };
