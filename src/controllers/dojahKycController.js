import Kyc from '../models/Kyc.js';
import User from '../models/User.js';
import Artisan from '../models/Artisan.js';
import { createNotification } from '../utils/notifier.js';
import { normalizeBase64Image, verifyNinWithSelfie } from '../services/dojahService.js';

const APPROVED_FLAGS = { kycLevel: 2, kycVerified: true, isVerified: true };
const UNAPPROVED_FLAGS = { kycLevel: 1, kycVerified: false, isVerified: false };

function readSelfieVerification(dojahResponse = {}) {
  const entity = dojahResponse?.entity || dojahResponse?.data?.entity || {};
  const verification = entity.selfie_verification || entity.selfieVerification || {};
  const match = verification.match === true || String(verification.match).toLowerCase() === 'true';
  const confidenceValue = Number(
    verification.confidence_value ??
    verification.confidenceValue ??
    verification.confidence ??
    0
  );

  return { entity, verification, match, confidenceValue };
}

function sanitizeDojahResponse(value) {
  if (!value || typeof value !== 'object') return value;
  const clone = JSON.parse(JSON.stringify(value));
  const entity = clone.entity || clone.data?.entity;
  if (entity) {
    if (entity.photo) entity.photo = '[redacted]';
    if (entity.image) entity.image = '[redacted]';
    if (entity.selfie_image) entity.selfie_image = '[redacted]';
  }
  return clone;
}

async function readMultipartPayload(request) {
  const payload = {};
  if (!request.isMultipart || typeof request.parts !== 'function') return payload;

  for await (const part of request.parts()) {
    const field = part.fieldname || part.field;
    if (!field) continue;

    if (part.file) {
      const chunks = [];
      for await (const chunk of part.file) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (field === 'selfie' || field === 'selfieImage' || field === 'selfie_image') {
        payload.selfieImage = buffer.toString('base64');
      }
      continue;
    }

    payload[field] = part.value;
  }

  return payload;
}

async function syncVerificationState({ userId, status, request }) {
  const approved = status === 'approved';
  const flags = approved ? APPROVED_FLAGS : UNAPPROVED_FLAGS;
  const [user, artisan] = await Promise.all([
    User.findByIdAndUpdate(userId, { $set: flags }, { new: true }),
    Artisan.findOneAndUpdate({ userId }, { $set: { verified: approved } }, { new: true }),
  ]);

  if (approved && user) {
    await createNotification(request.server, userId, {
      type: 'verification',
      title: 'ID verification approved',
      body: 'Your ID has been verified. You can now apply for jobs.',
      data: { verified: true, sendEmail: true, email: user.email },
    }).catch((err) => request.log?.warn?.('verification notification failed', err?.message || err));
  }

  return { user, artisan };
}

export async function verifyNinSelfie(request, reply) {
  const userId = request.user?.id;
  if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });

  try {
    const multipartPayload = await readMultipartPayload(request);
    const payload = { ...(request.body || {}), ...multipartPayload };
    const nin = String(payload.nin || payload.idNumber || '').trim();
    const selfieImage = normalizeBase64Image(payload.selfieImage || payload.selfie_image || payload.selfie || '');
    const firstName = payload.firstName || payload.first_name;
    const lastName = payload.lastName || payload.last_name;
    const confidenceThreshold = Number(process.env.DOJAH_NIN_SELFIE_CONFIDENCE_THRESHOLD || 90);

    if (!nin) return reply.code(400).send({ success: false, message: 'nin is required' });
    if (!/^\d{11}$/.test(nin)) return reply.code(400).send({ success: false, message: 'nin must be 11 digits' });
    if (!selfieImage) return reply.code(400).send({ success: false, message: 'selfieImage is required' });

    let dojahResponse;
    try {
      dojahResponse = await verifyNinWithSelfie({ nin, selfieImage, firstName, lastName });
    } catch (err) {
      const failureReason = err.code === 'DOJAH_CONFIG_MISSING'
        ? err.message
        : err.response?.data?.message || err.response?.data?.error || err.message || 'Dojah verification failed';

      const kyc = await Kyc.findOneAndUpdate(
        { userId },
        {
          $set: {
            userId,
            IdType: 'NIN',
            idNumber: nin,
            provider: 'dojah',
            verificationType: 'nin_selfie',
            status: 'pending_review',
            providerStatus: 'failed',
            failureReason,
            providerResponse: sanitizeDojahResponse(err.response?.data || null),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, sort: { createdAt: -1 } }
      );

      await syncVerificationState({ userId, status: kyc.status, request });
      request.log?.warn?.({ err: failureReason, userId }, 'Dojah NIN selfie verification moved to manual review');

      return reply.code(err.code === 'DOJAH_CONFIG_MISSING' ? 500 : 202).send({
        success: err.code !== 'DOJAH_CONFIG_MISSING',
        message: err.code === 'DOJAH_CONFIG_MISSING'
          ? 'Dojah verification is not configured'
          : 'Automatic verification could not be completed. KYC moved to manual review.',
        data: {
          status: kyc.status,
          failureReason,
        },
      });
    }

    const { entity, match, confidenceValue } = readSelfieVerification(dojahResponse);
    const approved = match && confidenceValue >= confidenceThreshold;
    const status = approved ? 'approved' : 'rejected';
    const failureReason = approved
      ? null
      : `Selfie verification failed or confidence below threshold (${confidenceValue}/${confidenceThreshold})`;

    const kyc = await Kyc.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          IdType: 'NIN',
          idNumber: nin,
          provider: 'dojah',
          verificationType: 'nin_selfie',
          status,
          providerStatus: approved ? 'verified' : 'not_verified',
          verifiedAt: approved ? new Date() : undefined,
          failureReason,
          firstName: entity.first_name || entity.firstname || firstName || undefined,
          lastName: entity.last_name || entity.lastname || lastName || undefined,
          selfieVerification: {
            match,
            confidenceValue,
            threshold: confidenceThreshold,
          },
          providerResponse: sanitizeDojahResponse(dojahResponse),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, sort: { createdAt: -1 } }
    );

    const synced = await syncVerificationState({ userId, status, request });

    return reply.send({
      success: true,
      message: approved ? 'NIN selfie verification approved' : 'NIN selfie verification rejected',
      data: {
        status: kyc.status,
        match,
        confidenceValue,
        threshold: confidenceThreshold,
        user: synced.user ? {
          _id: synced.user._id,
          kycVerified: synced.user.kycVerified,
          isVerified: synced.user.isVerified,
          kycLevel: synced.user.kycLevel,
        } : null,
        artisan: synced.artisan ? {
          _id: synced.artisan._id,
          verified: synced.artisan.verified,
        } : null,
      },
    });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to verify NIN selfie' });
  }
}
