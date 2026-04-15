import Review from '../models/Review.js';

export async function listReviews(request, reply) {
  try {
    const { artisanId: q_artisanId, targetId, artisan, artisan_id, page = 1, limit = 20 } = request.query || {};
    const artisanId = q_artisanId || targetId || artisan || artisan_id || null;
    // Log incoming query for debugging
    request.log?.info?.({ query: request.query }, 'reviews.list - incoming query');
    const q = {};
    if (artisanId) {
      const mongoose = (await import('mongoose')).default;
      // If the provided id is a valid ObjectId, attempt to match both possible storage forms:
      // - reviews that store the artisan as the User _id (artisanId)
      // - reviews that (older code) may have stored the Artisan document _id in the same field
      if (mongoose.Types.ObjectId.isValid(artisanId)) {
        try {
          const Artisan = (await import('../models/Artisan.js')).default;
          const artisanDoc = await Artisan.findOne({ userId: artisanId }).select('_id').lean();
          request.log?.info?.({ artisanLookup: artisanDoc || null }, 'reviews.list - artisan lookup');
          if (artisanDoc) {
            q.$or = [{ artisanId }, { artisanId: artisanDoc._id }];
          } else {
            q.artisanId = artisanId;
          }
        } catch (e) {
          request.log?.error?.({ err: e?.message }, 'reviews.list - artisan lookup failed');
          // If Artisan lookup fails for any reason, fall back to direct match
          q.artisanId = artisanId;
        }
      } else {
        q.artisanId = artisanId;
      }
    }
    request.log?.info?.({ builtQuery: q }, 'reviews.list - built query');
    const reviews = await Review.find(q)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });
    // Log result summary
    request.log?.info?.({ artisanId: artisanId || null, count: reviews.length }, 'reviews.list - fetched');
    if (artisanId && reviews.length === 0) {
      try {
        const sample = await Review.findOne({}).lean();
        request.log?.info?.({ sample: sample || null }, 'reviews.list - sample doc when filtered returned 0');
      } catch (e) {
        request.log?.error?.({ err: e?.message }, 'reviews.list - sample fetch failed');
      }
    }
    return reply.send({ success: true, data: reviews });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list reviews' });
  }
}

export async function createReview(request, reply) {
  try {
    const payload = request.body || {};
    const customerId = request.user?.id;
    const artisanUserId = payload.targetId; // expecting a User _id for the artisan
    if (!customerId) return reply.code(401).send({ success: false, message: 'Authentication required' });
    if (!artisanUserId) return reply.code(400).send({ success: false, message: 'targetId (artisan user id) is required' });
    const rating = Number(payload.rating || 0);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) return reply.code(400).send({ success: false, message: 'rating must be a number between 1 and 5' });

    const reviewPayload = {
      customerId,
      artisanId: artisanUserId,
      rating,
      comment: payload.comment || '',
      bookingId: payload.bookingId,
    };

    // Defensive check: do not allow duplicate review by same customer for same artisan
    const existing = await Review.findOne({ customerId, artisanId: artisanUserId });
    if (existing) return reply.code(409).send({ success: false, message: 'You have already reviewed this artisan' });

    let review;
    try {
      review = await Review.create(reviewPayload);
    } catch (createErr) {
      // Handle duplicate key race condition gracefully
      if (createErr && createErr.code === 11000) {
        return reply.code(409).send({ success: false, message: 'You have already reviewed this artisan' });
      }
      throw createErr;
    }

    // mark booking reviewed if bookingId provided
    try {
      if (payload.bookingId) {
        const Booking = (await import('../models/Booking.js')).default;
        await Booking.findByIdAndUpdate(payload.bookingId, { reviewed: true, awaitingReview: false });
      }
    } catch (e) {
      request.log?.error?.('mark booking reviewed failed', e?.message);
    }

    // update artisan aggregate stats
    try {
      const Artisan = (await import('../models/Artisan.js')).default;
      const artisan = await Artisan.findOne({ userId: artisanUserId });
      if (artisan) {
        const total = (artisan.rating || 0) * (artisan.reviewsCount || 0) + rating;
        artisan.reviewsCount = (artisan.reviewsCount || 0) + 1;
        artisan.rating = total / artisan.reviewsCount;
        // recalculate rank if model has method
        if (typeof artisan.calculateRanking === 'function') artisan.calculateRanking();
        await artisan.save();
      }
    } catch (e) {
      request.log?.error?.('update artisan rating failed', e?.message);
    }

    return reply.code(201).send({ success: true, data: review });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function getReview(request, reply) {
  try {
    const review = await Review.findById(request.params.id);
    if (!review) return reply.code(404).send({ success: false, message: 'Not found' });
    return reply.send({ success: true, data: review });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get review' });
  }
}
