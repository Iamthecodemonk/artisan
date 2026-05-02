import dotenv from 'dotenv';

dotenv.config();
export function getPaystackCallbackUrl() {
  const explicit = String(process.env.PAYSTACK_CALLBACK_URL || '').trim();
  if (explicit) return explicit;

  const baseUrl = String(process.env.API_BASE_URL || process.env.PUBLIC_API_BASE_URL || 'https://rijhub.com')
    .trim()
    .replace(/\/+$/, '');

  return `${baseUrl}/api/payments/callback`;
}
