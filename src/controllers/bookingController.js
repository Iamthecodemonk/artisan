import Booking from '../models/Booking.js';
import Transaction from '../models/Transaction.js';
import Wallet from '../models/Wallet.js';
import Artisan from '../models/Artisan.js';
import Chat from '../models/Chat.js';
import { createNotification } from '../utils/notifier.js';
import { getConfig } from '../utils/config.js';
import axios from 'axios';
import ArtisanService from '../models/ArtisanService.js';
import JobSubCategory from '../models/JobSubCategory.js';
import { sendSms as sendChampSms } from '../utils/sendchamp.js';

function normalizePhone(phone) {
  if (!phone) return phone;
  try {
    return String(phone).replace(/[^0-9]/g, '');
  } catch (e) { return phone; }
}

// Resolve an incoming artisan identifier (may be Artisan._id or User._id) to the canonical User._id
async function resolveToUserId(id) {
  if (!id) return null;
  try {
    // Try as Artisan._id
    const byArtisanId = await Artisan.findById(id).lean();
    if (byArtisanId && byArtisanId.userId) return String(byArtisanId.userId);
    // Try as Artisan.userId
    const byUserId = await Artisan.findOne({ userId: id }).lean();
    if (byUserId && byUserId.userId) return String(byUserId.userId);
    // Try as a User._id
    try {
      const UserModel = (await import('../models/User.js')).default;
      const u = await UserModel.findById(id).select('_id').lean();
      if (u) return String(u._id);
    } catch (e) {
      // ignore
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Orchestration: create booking + initialize payment (one-call hire endpoint)
export async function hireAndInitialize(request, reply) {
  try {
    const { artisanId: incomingArtisanId, schedule, price: providedPrice, notes, email, customerCoords, categoryId, subCategoryId, artisanServiceId, services } = request.body || {};
    if (!incomingArtisanId || !schedule || !email) return reply.code(400).send({ success: false, message: 'artisanId, schedule and email are required' });

    const artisanUserId = await resolveToUserId(incomingArtisanId);
    if (!artisanUserId) return reply.code(404).send({ success: false, message: 'Artisan not found' });

    let price = providedPrice;
    let serviceName = null;

    // If multiple services provided, compute server-side total using ArtisanService pricing
    if (Array.isArray(services) && services.length > 0) {
      // fetch artisan's service price list(s). Search both canonical user id and original incoming id across all categories
      const incomingId = incomingArtisanId;
      const svcDocs = await ArtisanService.find({ artisanId: { $in: [artisanUserId, incomingId] } }).lean();
      request.log?.debug?.({ msg: 'hireAndInitialize: found svcDocs', incomingArtisanId, artisanUserId, svcCount: svcDocs?.length || 0 });
      if (!svcDocs || svcDocs.length === 0) return reply.code(400).send({ success: false, message: 'No services configured for this artisan and category' });

      // aggregate service entries across found docs to support legacy splits
      const allServiceEntries = [];
      for (const d of svcDocs) if (Array.isArray(d.services)) allServiceEntries.push(...d.services);
      try {
        const svcSummary = svcDocs.map(d => ({ id: String(d._id), artisanId: String(d.artisanId), services: (d.services || []).map(s => String(s.subCategoryId)) }));
        request.log?.debug?.({ msg: 'hireAndInitialize: svcSummary', svcSummary, allServiceEntriesCount: allServiceEntries.length });
      } catch (e) { /* ignore logging errors */ }

      const subIds = services.map(s => String(s.subCategoryId));
      const subs = await JobSubCategory.find({ _id: { $in: subIds } }).select('name').lean();
      const subMap = {}; subs.forEach(s => { subMap[String(s._id)] = s; });

      const normalized = [];
      let total = 0;
      for (const s of services) {
        const subId = String(s.subCategoryId);
        const qty = Math.max(1, Number(s.quantity || 1));
        const entry = allServiceEntries.find(x => String(x.subCategoryId) === subId);
        if (!entry) {
          request.log?.debug?.({ msg: 'hireAndInitialize: missing sub service', subId, allServiceEntriesSubIds: allServiceEntries.map(ae => String(ae.subCategoryId)) });
          return reply.code(400).send({ success: false, message: `Sub service ${subId} not offered by artisan` });
        }
        const unit = Number(entry.price || 0);
        const t = unit * qty;
        normalized.push({ subCategoryId: subId, name: subMap[subId]?.name || '', unitPrice: unit, quantity: qty, totalPrice: t });
        total += t;
      }
      price = total;
      serviceName = normalized.map(n => n.name || '').filter(Boolean).join(', ');
      // attach normalized services to payload for persistence
      request.body.services = normalized;
    } else if ((!price || Number(price) === 0) && (subCategoryId || artisanServiceId)) {
      const svcQuery = { artisanId };
      if (artisanServiceId) svcQuery._id = artisanServiceId;
      if (categoryId) svcQuery.categoryId = categoryId;
      // search both user id and original incoming id (to support legacy records)
      const svcDocsSingle = await ArtisanService.find({ artisanId: { $in: [incomingArtisanId, artisanUserId] }, categoryId }).lean();
      if (!svcDocsSingle || svcDocsSingle.length === 0) return reply.code(400).send({ success: false, message: 'No services configured for this artisan and category' });
      let entry = null;
      for (const sd of svcDocsSingle) {
        if (!Array.isArray(sd.services)) continue;
        entry = sd.services.find(s => String(s.subCategoryId) === String(subCategoryId));
        if (entry) break;
      }
      if (!entry) return reply.code(400).send({ success: false, message: 'Sub service not offered by artisan' });
      price = entry.price;
      const sub = await JobSubCategory.findById(subCategoryId).select('name').lean();
      serviceName = sub?.name || null;
    }

    if (!price || Number(price) <= 0) return reply.code(400).send({ success: false, message: 'price is required or must be resolvable from artisan services' });

    const payload = { artisanId: artisanUserId, schedule, price, notes };
    if (serviceName) payload.service = serviceName;
    if (request.body.services) payload.services = request.body.services;
    // prefer authenticated user id
    if (request.user && request.user.id) payload.customerId = request.user.id;

    const booking = await Booking.create(payload);

    // NOTE: notification moved below to run after payment initialization

    // If Paystack not configured, return booking and instruct client to pay separately
    if (!process.env.PAYSTACK_SECRET_KEY) {
      // notify artisan asynchronously in background so this endpoint returns quickly
      (async () => {
        try {
          const User = (await import('../models/User.js')).default;
          const artisanUser = await User.findById(booking.artisanId).select('phone email name').lean();
          const artisanEmail = artisanUser?.email;
          await createNotification(request.server, booking.artisanId, { type: 'booking', title: 'New booking', body: `A new booking (${booking._id}) was created.`, data: { bookingId: booking._id, sendEmail: true, email: artisanEmail } });
          try {
            const artisanPhone = normalizePhone(artisanUser?.phone);
            // try to obtain customer info from request.user or booking payload
            let customerName = request.user?.name || null;
            let customerPhone = normalizePhone(request.user?.phone || null);
            if (!customerName && booking.customerId) {
              try { const cu = await User.findById(booking.customerId).select('name phone').lean(); if (cu) { customerName = cu.name; customerPhone = normalizePhone(cu.phone); } } catch (e) { /* ignore */ }
            }
            if (artisanPhone) {
              const msg = `New booking ${booking._id}\nService: ${booking.service || 'N/A'}\nAmount: ${booking.price || 'N/A'}\nSchedule: ${booking.schedule || 'N/A'}\nCustomer: ${customerName || 'N/A'} ${customerPhone ? '(' + customerPhone + ')' : ''}\nNotes: ${booking.notes || ''}`;
              await sendChampSms(artisanPhone, msg);
            }
          } catch (smsErr) {
            request.log?.warn?.('async send SMS to artisan failed', smsErr?.message || smsErr);
          }
        } catch (e) {
          request.log?.warn?.('async notify artisan on booking failed', e?.message || e);
        }
      })();

      return reply.code(201).send({ success: true, message: 'Booking created (Paystack not configured)', data: { booking } });
    }

    // initialize paystack transaction
    const amountInKobo = Math.round(Number(price) * 100);
    const res = await axios.post('https://api.paystack.co/transaction/initialize', {
      email,
      amount: amountInKobo,
      metadata: { bookingId: booking._id, customerCoords }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const init = res?.data?.data;
    if (init) {
      // create local transaction record for reconciliation
      await Transaction.create({ bookingId: booking._id, payerId: payload.customerId || null, amount: Number(price) || 0, status: 'pending', paymentGatewayRef: init.reference });
    }

    // notify artisan asynchronously after payment initialization to avoid blocking response
    (async () => {
      try {
        const User = (await import('../models/User.js')).default;
        const artisanUser = await User.findById(booking.artisanId);
        const artisanEmail = artisanUser?.email;
        await createNotification(request.server, booking.artisanId, { type: 'booking', title: 'New booking', body: `A new booking (${booking._id}) was created.`, data: { bookingId: booking._id, sendEmail: true, email: artisanEmail } });
        try {
          const artisanPhone = artisanUser?.phone;
          if (artisanPhone) {
            // try to obtain customer info from request.user or booking payload
            let customerName = request.user?.name || null;
            let customerPhone = normalizePhone(request.user?.phone || null);
            if (!customerName && booking.customerId) {
              try { const cu = await User.findById(booking.customerId).select('name phone').lean(); if (cu) { customerName = cu.name; customerPhone = normalizePhone(cu.phone); } } catch (e) { /* ignore */ }
            }
            const msg = `New booking ${booking._id}\nService: ${booking.service || 'N/A'}\nAmount: ${booking.price || 'N/A'}\nSchedule: ${booking.schedule || 'N/A'}\nCustomer: ${customerName || 'N/A'} ${customerPhone ? '(' + customerPhone + ')' : ''}\nNotes: ${booking.notes || ''}`;
            await sendChampSms(artisanPhone, msg);
          }
        } catch (smsErr) {
          request.log?.warn?.('async send SMS to artisan after payment init failed', smsErr?.message || smsErr);
        }
      } catch (e) {
        request.log?.warn?.('async notify artisan after payment init failed', e?.message || e);
      }
    })();

    return reply.code(201).send({ success: true, data: { booking, payment: res.data.data } });
  } catch (err) {
    request.log?.error?.(err?.response?.data || err?.message || err);
    return reply.code(500).send({ success: false, message: 'Failed to create booking and initialize payment' });
  }
}

export async function listBookings(request, reply) {
  try {
    const { page = 1, limit = 20, status } = request.query || {};
    const q = {};
    if (status) q.status = status;
    const bookings = await Booking.find(q)
      .select('service schedule status price customerId artisanId acceptedQuote createdAt paymentStatus')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 })
      .lean();
    return reply.send({ success: true, data: bookings });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list bookings' });
  }
}

// GET bookings for a specific customer with artisan user and profile details
export async function getCustomerBookings(request, reply) {
  try {
    const customerId = request.params.customerId || request.query.customerId || request.user?.id;
    if (!customerId) return reply.code(400).send({ success: false, message: 'customerId is required' });

    // authorize: customer themselves or admin
    if (String(request.user?.id) !== String(customerId) && request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, message: 'Forbidden' });
    }

    const { page = 1, limit = 20, status } = request.query || {};
    const q = { customerId };
    if (status) q.status = status;

    // fetch bookings with projection and lean
    const bookings = await Booking.find(q)
      .select('service schedule status price customerId artisanId acceptedQuote createdAt paymentStatus')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 })
      .lean();

    // attach artisan user basic fields in batch
    const artisanIds = [...new Set(bookings.map(b => String(b.artisanId || '')).filter(Boolean))];
    const UserModel = (await import('../models/User.js')).default;
    const artisanUsers = artisanIds.length ? await UserModel.find({ _id: { $in: artisanIds } }, 'name email profileImage phone').lean() : [];
    const artisanMapUser = {}; for (const u of artisanUsers) artisanMapUser[String(u._id)] = u;

    // attach artisan profiles
    const artisanProfiles = artisanIds.length ? await Artisan.find({ userId: { $in: artisanIds } }).lean() : [];
    const artisanProfileMap = {}; artisanProfiles.forEach(a => { artisanProfileMap[String(a.userId)] = a; });

    const result = bookings.map(b => ({
      booking: b,
      artisanUser: artisanMapUser[String(b.artisanId)] || null,
      artisanProfile: artisanProfileMap[String(b.artisanId)] || null,
    }));

    return reply.send({ success: true, data: result });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to fetch customer bookings' });
  }
}

// GET bookings for a specific artisan with customer user and profile details
export async function getArtisanBookings(request, reply) {
  try {
    const artisanId = request.params.artisanId || request.query.artisanId || request.user?.id;
    if (!artisanId) return reply.code(400).send({ success: false, message: 'artisanId is required' });

    // authorize: artisan themselves or admin
    if (String(request.user?.id) !== String(artisanId) && request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, message: 'Forbidden' });
    }

    const { page = 1, limit = 20, status } = request.query || {};
    const q = { artisanId };
    if (status) q.status = status;

    // fetch bookings with projection and lean
    const bookings = await Booking.find(q)
      .select('service schedule status price customerId artisanId acceptedQuote createdAt paymentStatus')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 })
      .lean();

    const customerIds = [...new Set(bookings.map(b => String(b.customerId || '')).filter(Boolean))];
    const UserModel = (await import('../models/User.js')).default;
    const customerUsers = customerIds.length ? await UserModel.find({ _id: { $in: customerIds } }, 'name email profileImage phone').lean() : [];
    const customerMap = {}; for (const u of customerUsers) customerMap[String(u._id)] = u;

    const result = bookings.map(b => ({ booking: b, customerUser: customerMap[String(b.customerId)] || null }));

    return reply.send({ success: true, data: result });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to fetch artisan bookings' });
  }
}

export async function createBooking(request, reply) {
  try {
    const payload = request.body || {};
    // If multiple services provided, compute server-side total using ArtisanService pricing
    if (Array.isArray(payload.services) && payload.services.length > 0) {
      // normalize incoming artisan id to User._id
      const artisanUserId = await resolveToUserId(payload.artisanId);
      if (!artisanUserId) return reply.code(404).send({ success: false, message: 'Artisan not found' });
      payload.artisanId = artisanUserId;
      // fetch all ArtisanService docs for this artisan (support legacy artisan._id records too)
      const svcDocsAll = await ArtisanService.find({ artisanId: { $in: [payload.artisanId, payload.artisanId] } }).lean();
      if (!svcDocsAll || svcDocsAll.length === 0) return reply.code(400).send({ success: false, message: 'No services configured for this artisan' });
      const allServiceEntries = [];
      for (const d of svcDocsAll) if (Array.isArray(d.services)) allServiceEntries.push(...d.services);

      const subIds = payload.services.map(s => String(s.subCategoryId));
      const subs = await JobSubCategory.find({ _id: { $in: subIds } }).select('name').lean();
      const subMap = {}; subs.forEach(s => { subMap[String(s._id)] = s; });

      const normalized = [];
      let total = 0;
      for (const s of payload.services) {
        const subId = String(s.subCategoryId);
        const qty = Math.max(1, Number(s.quantity || 1));
        const entry = allServiceEntries.find(x => String(x.subCategoryId) === subId);
        if (!entry) return reply.code(400).send({ success: false, message: `Sub service ${subId} not offered by artisan` });
        const unit = Number(entry.price || 0);
        const t = unit * qty;
        normalized.push({ subCategoryId: subId, name: subMap[subId]?.name || '', unitPrice: unit, quantity: qty, totalPrice: t });
        total += t;
      }
      payload.price = total;
      payload.service = normalized.map(n => n.name).filter(Boolean).join(', ');
      payload.services = normalized;
    } else {
      // Attempt to resolve price from artisan services when subCategoryId provided
      if ((!payload.price || Number(payload.price) === 0) && payload.subCategoryId && payload.artisanId) {
        // normalize incoming artisan id to User._id
        const artisanUserId2 = await resolveToUserId(payload.artisanId);
        if (!artisanUserId2) return reply.code(404).send({ success: false, message: 'Artisan not found' });
        payload.artisanId = artisanUserId2;
        const svcDoc = await ArtisanService.findOne({ artisanId: payload.artisanId, categoryId: payload.categoryId }).lean();
        if (svcDoc) {
          const entry = svcDoc.services.find(s => String(s.subCategoryId) === String(payload.subCategoryId));
          if (entry) {
            payload.price = entry.price;
            const sub = await JobSubCategory.findById(payload.subCategoryId).select('name').lean();
            if (sub) payload.service = sub.name;
          }
        }
      }
    }

    const booking = await Booking.create(payload);
    // notify artisan asynchronously (non-blocking)
    (async () => {
      try {
        const User = (await import('../models/User.js')).default;
        const artisanUser = await User.findById(booking.artisanId);
        const artisanPhone = artisanUser?.phone;
        if (artisanPhone) {
          // attempt to include customer info
          let customerName = request.user?.name || null;
          let customerPhone = normalizePhone(request.user?.phone || null);
          if (!customerName && booking.customerId) {
            try { const cu = await User.findById(booking.customerId).select('name phone').lean(); if (cu) { customerName = cu.name; customerPhone = normalizePhone(cu.phone); } } catch (e) { /* ignore */ }
          }
          const msg = `New booking ${booking._id}\nService: ${booking.service || 'N/A'}\nAmount: ${booking.price || 'N/A'}\nSchedule: ${booking.schedule || 'N/A'}\nCustomer: ${customerName || 'N/A'} ${customerPhone ? '(' + customerPhone + ')' : ''}\nNotes: ${booking.notes || ''}`;
          await sendChampSms(artisanPhone, msg);
        }
        await createNotification(request.server, booking.artisanId, { type: 'booking', title: 'New booking', body: `A new booking (${booking._id}) was created.`, data: { bookingId: booking._id } });
      } catch (e) {
        request.log?.warn?.('async notify artisan on createBooking failed', e?.message || e);
      }
    })();

    return reply.code(201).send({ success: true, data: booking });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function getBooking(request, reply) {
  try {
    const booking = await Booking.findById(request.params.id);
    if (!booking) return reply.code(404).send({ success: false, message: 'Not found' });
    return reply.send({ success: true, data: booking });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get booking' });
  }
}

export async function cancelBooking(request, reply) {
  try {
    const booking = await Booking.findById(request.params.id).populate('customerId artisanId');
    if (!booking) return reply.code(404).send({ success: false, message: 'Not found' });

    // Only allow customer or admin to cancel (basic check). You may expand role checks.
    if (request.user && String(request.user.id) !== String(booking.customerId._id)) {
      // allow cancellation by the customer only for now
      return reply.code(403).send({ success: false, message: 'Forbidden' });
    }

    // If payment exists in holding or pending state, attempt to mark refunded and optionally call gateway refund
    const tx = await Transaction.findOne({ bookingId: booking._id, status: { $in: ['holding', 'pending'] } });
    if (tx) {
      // Prevent duplicate refunds: if transaction already refunded or a refund id exists, stop.
      if (tx.status === 'refunded' || tx.refundId || tx.refundStatus === 'refunded') {
        return reply.send({ success: true, message: 'Refund already initiated or transaction already refunded', data: booking });
      }
      // mark refund requested first
      booking.refundStatus = 'requested';
      booking.status = 'cancelled';
      booking.paymentStatus = 'unpaid';
      await booking.save();

      // Try gateway refund if Paystack secret key available
      if (process.env.PAYSTACK_SECRET_KEY && tx.paymentGatewayRef) {
        try {
          // Paystack refund endpoint: POST https://api.paystack.co/refund
          // Body: { transaction: <reference> }  (optionally amount)
          const res = await axios.post('https://api.paystack.co/refund', { transaction: tx.paymentGatewayRef }, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } });
          // Paystack returns { status: true, message: '', data: { status: 'success', ... } }
          const ok = res?.data?.status === true && (res.data.data?.status === 'success' || res.data.data?.status === 'refunded');
          if (ok) {
            // persist refund id for idempotency and future checks
            tx.refundId = res.data.data?.id || res.data.data?.reference || res.data.data?.refund_id || tx.refundId;
            tx.refundStatus = 'refunded';
            tx.status = 'refunded';
            await tx.save();
            booking.refundStatus = 'refunded';
            // keep paymentStatus aligned with Booking schema ("unpaid" or "paid").
            booking.paymentStatus = 'unpaid';
            await booking.save();
            await createNotification(request.server, booking.customerId._id, { type: 'refund', title: 'Refund processed', body: `Refund for booking ${booking._id} processed.`, data: { bookingId: booking._id } });
            return reply.send({ success: true, message: 'Cancelled and refund processed', data: booking, gateway: res.data });
          }
          // if gateway returned non-success, mark requested and notify
          request.log?.warn?.('refund not confirmed by gateway', res?.data);
          // store any refund id returned and mark requested for reconciliation
          tx.refundId = res.data.data?.id || res.data.data?.reference || res.data.data?.refund_id || tx.refundId;
          tx.refundStatus = tx.refundStatus || 'requested';
          await tx.save();
          await createNotification(request.server, booking.customerId._id, { type: 'refund', title: 'Refund requested', body: `Refund for booking ${booking._id} requested; gateway did not confirm immediate refund.`, data: { bookingId: booking._id } });
          return reply.send({ success: true, message: 'Cancelled; refund requested (gateway did not confirm)', data: booking, gateway: res.data });
        } catch (err) {
          request.log?.error?.('refund failed', err?.response?.data || err?.message);
          // store that a refund was requested for manual reconciliation
          tx.refundStatus = 'requested';
          await tx.save();
          await createNotification(request.server, booking.customerId._id, { type: 'refund', title: 'Refund requested', body: `Refund for booking ${booking._id} requested; manual processing required.`, data: { bookingId: booking._id } });
          return reply.send({ success: true, message: 'Cancelled; refund requested (gateway attempt failed)', data: booking });
        }
      }

      // If no gateway configured, mark tx refunded locally and notify for reconciliation
      tx.status = 'refunded';
      tx.refundStatus = 'refunded';
      await tx.save();
      booking.refundStatus = 'refunded';
      booking.status = 'cancelled';
      booking.paymentStatus = 'unpaid';
      await booking.save();
      await createNotification(request.server, booking.customerId._id, { type: 'refund', title: 'Refund processed', body: `Refund for booking ${booking._id} processed (internal).`, data: { bookingId: booking._id } });
      return reply.send({ success: true, message: 'Cancelled and refund processed (internal)', data: booking });
    }

    // No holding transaction — just cancel
    booking.status = 'cancelled';
    await booking.save();
    return reply.send({ success: true, message: 'Cancelled', data: booking });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function getRefundStatus(request, reply) {
  try {
    const booking = await Booking.findById(request.params.id);
    if (!booking) return reply.code(404).send({ success: false, message: 'Not found' });

    const tx = await Transaction.findOne({ bookingId: booking._id });
    if (!tx) return reply.code(404).send({ success: false, message: 'No transaction found for booking' });

    // if we have a refund id and Paystack configured, query gateway
    if (tx.refundId && process.env.PAYSTACK_SECRET_KEY) {
      try {
        const res = await axios.get(`https://api.paystack.co/refund/${tx.refundId}`, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } });
        // Optionally persist any status change
        const gatewayStatus = res?.data?.data?.status;
        if (gatewayStatus === 'success' || gatewayStatus === 'refunded') {
          tx.refundStatus = 'refunded';
          tx.status = 'refunded';
          await tx.save();
          booking.refundStatus = 'refunded';
          await booking.save();
        }
        return reply.send({ success: true, data: res.data });
      } catch (err) {
        request.log?.error?.('refund status query failed', err?.response?.data || err?.message);
        return reply.code(500).send({ success: false, message: 'Failed to query refund status' });
      }
    }

    // Fallback: return stored refund status
    return reply.send({ success: true, data: { refundId: tx.refundId || null, refundStatus: tx.refundStatus || 'none' } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to fetch refund status' });
  }
}

export async function completeBooking(request, reply) {
  try {
    const booking = await Booking.findById(request.params.id).populate('customerId artisanId');
    if (!booking) return reply.code(404).send({ success: false, message: 'Not found' });
    if (String(booking.customerId._id) !== String(request.user?.id)) return reply.code(403).send({ success: false, message: 'Forbidden' });
    if (!['in-progress', 'accepted'].includes(booking.status)) return reply.code(400).send({ success: false, message: 'Invalid booking state' });

    // mark booking completed when customer marks it complete
    booking.status = 'completed';
    booking.awaitingReview = true;
    await booking.save();

    // release payment if transaction in holding
    const tx = await Transaction.findOne({ bookingId: booking._id, status: 'holding' });
    if (tx) {
      let feePct = 0;
      try {
        const cfgVal = await getConfig('COMPANY_FEE_PCT');
        if (cfgVal !== null && !isNaN(Number(cfgVal))) feePct = Number(cfgVal);
        else request.log?.warn?.('COMPANY_FEE_PCT not set in DB; defaulting to 0');
      } catch (e) {
        request.log?.error?.('Failed to read COMPANY_FEE_PCT from config', e?.message || e);
      }
      const fee = Math.round((tx.amount * feePct) / 100 * 100) / 100;
      const payAmount = tx.amount - fee;
      tx.companyFee = fee;
      // mark transaction as paid (payout completed or credited to wallet)
      tx.status = 'paid';
      tx.releasedAt = new Date();
      await tx.save();

      // Determine whether to auto-payout via Paystack or credit internal wallet
      const autoPayout = String(process.env.PAYSTACK_AUTO_PAYOUT || '').toLowerCase() === 'true';

      // If auto-payout is enabled and Paystack configured and artisan has recipient code, attempt transfer
      let transferAttempted = false;
      let transferSucceeded = false;
      const artisanDoc = await Artisan.findOne({ userId: booking.artisanId._id });
      // Prefer recipient code stored on the artisan's wallet; fall back to artisan doc
      let wallet = await Wallet.findOne({ userId: booking.artisanId._id });
      if (!wallet) wallet = await Wallet.create({ userId: booking.artisanId._id });

      let recipientCode = wallet?.paystackRecipientCode || artisanDoc?.paystackRecipientCode || null;

      // If we have payoutDetails but no recipientCode, try to create a Paystack recipient (server-side)
      if (!recipientCode && process.env.PAYSTACK_SECRET_KEY && wallet?.payoutDetails && wallet.payoutDetails.account_number && wallet.payoutDetails.bank_code && wallet.payoutDetails.name) {
        try {
          const pr = await axios.post('https://api.paystack.co/transferrecipient', {
            type: 'nuban',
            name: wallet.payoutDetails.name,
            account_number: wallet.payoutDetails.account_number,
            bank_code: wallet.payoutDetails.bank_code,
            currency: wallet.payoutDetails.currency || 'NGN'
          }, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } });
          const pData = pr?.data?.data;
          if (pData && pData.recipient_code) {
            recipientCode = pData.recipient_code;
            // persist recipient code on wallet and artisan for compatibility
            wallet.paystackRecipientCode = recipientCode;
            wallet.paystackRecipientMeta = pData;
            await wallet.save();
            try {
              if (artisanDoc) {
                artisanDoc.paystackRecipientCode = recipientCode;
                artisanDoc.paystackRecipientMeta = pData;
                await artisanDoc.save();
              }
            } catch (e) { request.log?.warn?.('failed to update artisan with recipient code', e?.message || e); }
          }
        } catch (e) {
          request.log?.error?.('create paystack recipient failed', e?.response?.data || e?.message || e);
        }
      }

      if (autoPayout && process.env.PAYSTACK_SECRET_KEY && recipientCode) {
        transferAttempted = true;
        try {
          const amountKobo = Math.round(payAmount * 100);
          const tRes = await axios.post('https://api.paystack.co/transfer', {
            source: 'balance',
            amount: amountKobo,
            recipient: recipientCode,
            reason: `Payout for booking ${booking._id}`
          }, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } });

          if (tRes?.data?.status === true) {
            // persist transfer reference and amount
            tx.transferRef = tRes.data.data?.transfer_code || tRes.data.data?.reference || tRes.data.data?.id;
            tx.transferAmount = payAmount;
            tx.transferStatus = tRes.data.data?.status || 'pending';
            await tx.save();
            transferSucceeded = ['success', 'processed', 'queued', 'pending'].includes((tx.transferStatus || '').toLowerCase());
          }
        } catch (e) {
          request.log?.error?.('auto payout failed', e?.response?.data || e?.message || e);
          // store pending transfer attempt status for manual reconciliation
          tx.transferStatus = tx.transferStatus || 'failed';
          await tx.save();
        }
      }

      // If not using auto-payout or auto-payout failed, credit internal artisan wallet
      if (!autoPayout || (!transferAttempted) || (transferAttempted && !transferSucceeded)) {
        let wallet = await Wallet.findOne({ userId: booking.artisanId._id });
        if (!wallet) wallet = await Wallet.create({ userId: booking.artisanId._id });
        wallet.balance = (wallet.balance || 0) + payAmount;
        wallet.totalEarned = (wallet.totalEarned || 0) + payAmount;
        wallet.totalJobs = (wallet.totalJobs || 0) + 1;
        wallet.lastUpdated = new Date();
        await wallet.save();
        // mark tx as paid when wallet credited
        tx.status = 'paid';
        await tx.save();
      }

      // Record company/platform commission and optionally credit company wallet
      try {
        const CompanyEarning = (await import('../models/CompanyEarning.js')).default;
        if (fee > 0) {
          try {
            await CompanyEarning.create({ transactionId: tx._id, bookingId: booking._id, amount: fee, note: 'Platform commission' });
          } catch (e) { request.log?.warn?.('failed to record company earning', e?.message || e); }

          if (process.env.COMPANY_USER_ID) {
            try {
              const companyUserId = process.env.COMPANY_USER_ID;
              let companyWallet = await Wallet.findOne({ userId: companyUserId });
              if (!companyWallet) companyWallet = await Wallet.create({ userId: companyUserId });
              companyWallet.balance = (companyWallet.balance || 0) + fee;
              companyWallet.totalEarned = (companyWallet.totalEarned || 0) + fee;
              companyWallet.lastUpdated = new Date();
              await companyWallet.save();
              // notify company/admin account if possible
              try { await createNotification(request.server, companyUserId, { type: 'commission', title: 'Commission received', body: `Commission of ${fee} credited for booking ${booking._id}`, data: { bookingId: booking._id, amount: fee } }); } catch (e) { request.log?.warn?.('company notify failed', e?.message); }
            } catch (e) { request.log?.error?.('credit company wallet failed', e?.message || e); }
          }
        }
      } catch (e) {
        request.log?.error?.('company commission handling failed', e?.message || e);
      }
    }

    // increment artisan stats
    const artisan = await Artisan.findOne({ userId: booking.artisanId._id });
    if (artisan) {
      artisan.analytics.leads = (artisan.analytics.leads || 0) + 1;
      await artisan.save();
    }

    // notify parties and send email summaries
    try {
      const artisanEmail = booking.artisanId?.email;
      const customerEmail = booking.customerId?.email;
      const paidAmount = (tx && (tx.amount - tx.companyFee)) || null;
      await createNotification(request.server, booking.artisanId._id, {
        type: 'job_complete',
        title: 'Job completed — payment sent',
        body: `The job ${booking._id} was completed. ${paidAmount !== null ? `You received ${paidAmount}.` : ''} Thank you!`,
        data: { bookingId: booking._id, amount: paidAmount, sendEmail: true, email: artisanEmail }
      });
      await createNotification(request.server, booking.customerId._id, {
        type: 'job_complete',
        title: 'Job completed — thank you',
        body: `Your job ${booking._id} has been marked complete and the artisan has been paid. Please leave a review.`,
        data: { bookingId: booking._id, sendEmail: true, email: customerEmail }
      });
    } catch (e) {
      request.log?.warn?.('notify parties failed', e?.message || e);
    }

    // close chat if present
    try {
      if (booking.chatId) {
        const chat = await Chat.findById(booking.chatId);
        if (chat) {
          chat.isClosed = true;
          await chat.save();
        }
      }
    } catch (e) {
      request.log?.warn?.('failed to close chat', e?.message || e);
    }

    // update customer wallet stats (totalSpent) for bookkeeping
    try {
      if (tx) {
        let customerWallet = await Wallet.findOne({ userId: booking.customerId._id });
        if (!customerWallet) customerWallet = await Wallet.create({ userId: booking.customerId._id });
        customerWallet.totalSpent = (customerWallet.totalSpent || 0) + (tx.amount || 0);
        customerWallet.lastUpdated = new Date();
        await customerWallet.save();
      }
    } catch (e) {
      request.log?.warn?.('failed to update customer wallet', e?.message || e);
    }

    // ensure booking reflects payment/closure state and prompt for review
    try {
      if (tx) {
        booking.paymentStatus = 'paid';
      }
      booking.awaitingReview = true;
      await booking.save();
    } catch (e) {
      request.log?.warn?.('failed to finalize booking state', e?.message || e);
    }

    return reply.send({ success: true, data: booking });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to complete booking' });
  }
}

// Endpoint to confirm payment for a booking (used by webhook or admin)
export async function confirmPayment(request, reply) {
  try {
    const bookingId = request.params.id;
    const booking = await Booking.findById(bookingId).populate('customerId artisanId');
    if (!booking) return reply.code(404).send({ success: false, message: 'Not found' });

    // find most recent pending transaction for this booking
    const tx = await Transaction.findOne({ bookingId: booking._id, status: { $in: ['pending'] } }).sort({ createdAt: -1 });
    if (!tx) return reply.code(404).send({ success: false, message: 'No pending transaction found' });

    // mark as holding (app holds the payment)
    tx.status = 'holding';
    await tx.save();

    booking.paymentStatus = 'paid';
    // Set status to awaiting-acceptance (artisan must accept)
    booking.status = 'awaiting-acceptance';
    await booking.save();

    // notify artisan that payment was received and needs their acceptance
    try { 
      await createNotification(request.server, booking.artisanId._id, { 
        type: 'booking', 
        title: 'New booking awaiting your acceptance', 
        body: `Payment for booking ${booking._id} received. Please accept or reject within 24 hours.`, 
        data: { bookingId: booking._id } 
      }); 
    } catch (e) { 
      request.log?.warn?.('notify failed', e?.message); 
    }

    return reply.send({ success: true, data: { booking, transaction: tx } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to confirm payment' });
  }
}

// Artisan accepts a booking
export async function acceptBooking(request, reply) {
  try {
    const booking = await Booking.findById(request.params.id).populate('customerId artisanId');
    if (!booking) return reply.code(404).send({ success: false, message: 'Booking not found' });

    // Only the artisan can accept their own booking
    if (String(booking.artisanId._id) !== String(request.user?.id)) {
      return reply.code(403).send({ success: false, message: 'Only the assigned artisan can accept this booking' });
    }

    // Check if booking is in correct state
    if (booking.status !== 'awaiting-acceptance') {
      return reply.code(400).send({ success: false, message: `Cannot accept booking with status: ${booking.status}` });
    }

    // Check if payment is confirmed
    if (booking.paymentStatus !== 'paid') {
      return reply.code(400).send({ success: false, message: 'Payment not confirmed yet' });
    }

    // Update booking
    booking.status = 'accepted';
    booking.artisanApprovalStatus = 'accepted';
    booking.artisanApprovalDate = new Date();
    await booking.save();

    // Notify customer
    try {
      await createNotification(request.server, booking.customerId._id, {
        type: 'booking',
        title: 'Booking accepted',
        body: `Your booking ${booking._id} has been accepted by the artisan. Work will begin as scheduled.`,
        data: { bookingId: booking._id }
      });
    } catch (e) {
      request.log?.warn?.('notify customer failed', e?.message);
    }

    return reply.send({ success: true, message: 'Booking accepted', data: booking });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to accept booking' });
  }
}

// Artisan rejects a booking
export async function rejectBooking(request, reply) {
  try {
    const { reason } = request.body || {};
    const booking = await Booking.findById(request.params.id).populate('customerId artisanId');
    if (!booking) return reply.code(404).send({ success: false, message: 'Booking not found' });

    // Only the artisan can reject their own booking
    if (String(booking.artisanId._id) !== String(request.user?.id)) {
      return reply.code(403).send({ success: false, message: 'Only the assigned artisan can reject this booking' });
    }

    // Check if booking is in correct state
    if (booking.status !== 'awaiting-acceptance') {
      return reply.code(400).send({ success: false, message: `Cannot reject booking with status: ${booking.status}` });
    }

    // Update booking
    booking.status = 'cancelled';
    booking.artisanApprovalStatus = 'rejected';
    booking.artisanApprovalDate = new Date();
    booking.rejectionReason = reason || 'Artisan declined the booking';
    booking.refundStatus = 'requested';
    await booking.save();

    // Process refund if payment was made
    if (booking.paymentStatus === 'paid') {
      const tx = await Transaction.findOne({ bookingId: booking._id, status: 'holding' });
      if (tx) {
        // Try to refund via Paystack
        if (process.env.PAYSTACK_SECRET_KEY && tx.paymentGatewayRef) {
          try {
            const res = await axios.post('https://api.paystack.co/refund', 
              { transaction: tx.paymentGatewayRef }, 
              { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } }
            );
            
            const ok = res?.data?.status === true;
            if (ok) {
              tx.refundId = res.data.data?.id || res.data.data?.reference;
              tx.refundStatus = 'refunded';
              tx.status = 'refunded';
              await tx.save();
              booking.refundStatus = 'refunded';
              await booking.save();
            }
          } catch (refundErr) {
            request.log?.warn?.('refund failed', refundErr?.response?.data || refundErr?.message);
          }
        }
      }
    }

    // Notify customer
    try {
      await createNotification(request.server, booking.customerId._id, {
        type: 'booking',
        title: 'Booking declined',
        body: `Your booking ${booking._id} was declined by the artisan. ${booking.refundStatus === 'refunded' ? 'Refund has been processed.' : 'Refund will be processed shortly.'}`,
        data: { bookingId: booking._id, reason: booking.rejectionReason }
      });
    } catch (e) {
      request.log?.warn?.('notify customer failed', e?.message);
    }

    return reply.send({ 
      success: true, 
      message: 'Booking rejected', 
      data: booking 
    });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to reject booking' });
  }
}