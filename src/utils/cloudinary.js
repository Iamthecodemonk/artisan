import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
dotenv.config();
const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY || process.env.CLOUD_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.CLOUD_SECRET;
// console.log(  'Cloudinary Config:', { cloudName, apiKey: apiKey ? '***' : null, apiSecret: apiSecret ? '***' : null });
cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: false,
});

// Fail fast if Cloudinary credentials are not provided. This prevents
// per-request upload errors and gives a clear actionable message at startup.
const missing = [];
if (!cloudName) missing.push('CLOUDINARY_CLOUD_NAME (or CLOUD_NAME)');
if (!apiKey) missing.push('CLOUDINARY_API_KEY (or CLOUD_KEY)');
if (!apiSecret) missing.push('CLOUDINARY_API_SECRET (or CLOUD_SECRET)');

if (missing.length) {
  const msg = `Missing Cloudinary configuration: ${missing.join(', ')}.\n` +
    'Set these environment variables (do not commit secrets) and restart the server.';
  // In production we fail fast. In development warn and continue so local dev isn't blocked.
  // eslint-disable-next-line no-console
  console.error('Cloudinary configuration:', msg);
  if (process.env.NODE_ENV === 'production') {
    throw new Error(msg);
  } else {
    // Provide a developer-friendly log and allow the server to boot without Cloudinary.
    console.warn('Continuing without Cloudinary (development mode). File uploads will fail until configured.');
  }
}

export default cloudinary;
