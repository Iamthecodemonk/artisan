import SpecialServiceRequest from '../models/SpecialServiceRequest.js';
import User from '../models/User.js';
import Artisan from '../models/Artisan.js';
import Booking from '../models/Booking.js';
import Transaction from '../models/Transaction.js';
import axios from 'axios';
import { createNotification } from '../utils/notifier.js';

// Create a new special service request (client)
export const createSpecialServiceRequest = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });

    const { artisanId, description, title, location, date, time, urgency, budget, categoryId, categoryName, attachments, service, serviceDescription } = req.body || {};
    if (!artisanId || !description) return reply.code(400).send({ success: false, message: 'artisanId and description required' });

    const client = await User.findById(userId).select('name email');
    const normalizeUrgency = (u) => {
      if (!u) return 'Normal';
      const s = String(u).trim().toLowerCase();
      if (s === 'high' || s === 'urgent') return 'High';
      if (s === 'low') return 'Low';
      return 'Normal';
    };

    // map shorthand client fields: `service` -> categoryName or title; `serviceDescription` -> description
    const resolvedTitle = title || service || undefined;
    const resolvedDescription = description || serviceDescription || undefined;

    const payload = {
      artisanId,
      clientId: userId,
      clientName: client?.name || '',
      artisanName: undefined,
      categoryId: categoryId || undefined,
      categoryName: categoryName || (service ? String(service) : undefined),
      title: resolvedTitle,
      description: resolvedDescription,
      location: location || undefined,
      date: date ? new Date(date) : undefined,
      time: time || undefined,
      urgency: normalizeUrgency(urgency),
      budget: typeof budget !== 'undefined' ? budget : undefined,
      attachments: Array.isArray(attachments) ? attachments : [],
      artisanReply: {},
    };

    // Try to resolve artisan name if available (accept Artisan._id or User._id)
    try {
      // perform both lookups in parallel and pick the first available name
      const [artisanDoc, userDoc] = await Promise.allSettled([
        Artisan.findById(artisanId).select('name').lean(),
        User.findById(artisanId).select('name').lean(),
      ]);
      if (artisanDoc.status === 'fulfilled' && artisanDoc.value) payload.artisanName = artisanDoc.value.name || '';
      else if (userDoc.status === 'fulfilled' && userDoc.value) payload.artisanName = userDoc.value.name || '';
    } catch (e) { /* ignore */ }

    // If multipart upload middleware populated uploadedFiles, merge them into attachments
    try {
      const uploaded = req.uploadedFiles;
      if (Array.isArray(uploaded) && uploaded.length) {
        payload.attachments = payload.attachments.concat(uploaded.map(f => ({ url: f.secure_url || f.url || f.path || '', filename: f.originalname || f.filename || '', mimeType: f.mimetype || f.mimeType || '' })));
      }
    } catch (e) {
      // ignore
    }

    const doc = await SpecialServiceRequest.create(payload);

    // Notify artisan
    try {
      await createNotification(req.server, artisanId, {
        title: 'New special service request',
        body: `${client?.name || 'A client'} sent you a request`,
        payload: { type: 'special_request', requestId: String(doc._id) }
      });
    } catch (e) {
      req.log?.warn?.('failed to send special request notification', e?.message || e);
    }

    return reply.code(201).send({ success: true, data: doc });
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to create request' });
  }
};

// List requests (supports artisanId / clientId / status filters)
export const listSpecialServiceRequests = async (req, reply) => {
  try {
    const { artisanId, clientId, status } = req.query || {};
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(100, Number(req.query?.limit || 50));
    const filter = {};
    if (artisanId) filter.artisanId = artisanId;
    if (clientId) filter.clientId = clientId;
    if (status) filter.status = status;

    const total = await SpecialServiceRequest.countDocuments(filter);
    const docs = await SpecialServiceRequest.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean();

    return reply.send({ success: true, data: docs, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list requests' });
  }
};

// Get single request
export const getSpecialServiceRequest = async (req, reply) => {
  try {
    const id = req.params.id;
    const doc = await SpecialServiceRequest.findById(id).lean();
    if (!doc) return reply.code(404).send({ success: false, message: 'Not found' });
    return reply.send({ success: true, data: doc });
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get request' });
  }
};

// Update request status or content
export const updateSpecialServiceRequest = async (req, reply) => {
  try {
    const id = req.params.id;
    const updates = req.body || {};
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });

    const doc = await SpecialServiceRequest.findById(id);
    if (!doc) return reply.code(404).send({ success: false, message: 'Not found' });

    // If artisan responding
    if (updates.status === 'responded') {
      // Ensure actor is the artisan (lightweight lookup)
      let artisan = null;
      try { artisan = await Artisan.findOne({ userId }).select('userId').lean(); } catch (e) { req.log?.warn?.('artisan lookup failed during special request update', e?.message || e); }
      const actorId = artisan ? String(artisan.userId) : String(userId);
      if (String(doc.artisanId) !== String(actorId)) return reply.code(403).send({ success: false, message: 'Forbidden' });

      // Parse note if JSON - support fixed or range quotes
      if (updates.note) {
        try {
          const parsed = typeof updates.note === 'string' ? JSON.parse(updates.note) : updates.note;
          doc.artisanReply = doc.artisanReply || {};
          // message
          if (parsed.message) doc.artisanReply.message = parsed.message;

          // fixed quote
          if (typeof parsed.quote !== 'undefined') {
            doc.artisanReply.quoteType = 'fixed';
            doc.artisanReply.quote = Number(parsed.quote);
            doc.artisanReply.minQuote = undefined;
            doc.artisanReply.maxQuote = undefined;
            doc.artisanReply.options = [];
          }

          // range quote (accept keys min/max or minQuote/maxQuote)
          const minRaw = parsed.min ?? parsed.minQuote ?? parsed.min_amount ?? parsed.minAmount;
          const maxRaw = parsed.max ?? parsed.maxQuote ?? parsed.max_amount ?? parsed.maxAmount;
          if (typeof minRaw !== 'undefined' && typeof maxRaw !== 'undefined') {
            const minV = Number(minRaw);
            const maxV = Number(maxRaw);
            if (!Number.isNaN(minV) && !Number.isNaN(maxV) && minV < maxV) {
              doc.artisanReply.quoteType = 'range';
              doc.artisanReply.minQuote = minV;
              doc.artisanReply.maxQuote = maxV;
              // generate 5 options evenly spaced
              const opts = [];
              for (let i = 0; i < 5; i++) {
                opts.push(Math.round(minV + (i * (maxV - minV) / 4)));
              }
              doc.artisanReply.options = opts;
              // clear fixed quote
              doc.artisanReply.quote = undefined;
            }
          }
        } catch (e) {
          // treat as plain message
          doc.artisanReply = doc.artisanReply || {};
          doc.artisanReply.message = String(updates.note);
        }
      }
      // Normalize urgency if provided
      if (typeof updates.urgency !== 'undefined') {
        const u = updates.urgency;
        const s = String(u).trim().toLowerCase();
        if (s === 'high' || s === 'urgent') doc.urgency = 'High';
        else if (s === 'low') doc.urgency = 'Low';
        else doc.urgency = 'Normal';
      }
      doc.artisanReply.responseAt = new Date();
      doc.artisanReply.artisanId = String(doc.artisanId);
      doc.status = 'responded';
      doc.updatedAt = new Date();
      await doc.save();

      // notify client
      try {
        await createNotification(req.server, doc.clientId, {
          title: 'Your request has a response',
          body: `Artisan responded to your special service request`,
          payload: { type: 'special_request', requestId: String(doc._id) }
        });
      } catch (e) { req.log?.warn?.('notify client failed', e?.message || e); }

      return reply.send({ success: true, data: doc });
    }

    // If client accepts
    if (updates.status === 'accepted') {
      if (String(doc.clientId) !== String(userId)) return reply.code(403).send({ success: false, message: 'Forbidden' });

      // Idempotency guard: if a booking already exists for this request, return it
      if (doc.bookingId) {
        try {
          const existingBooking = await Booking.findById(doc.bookingId).lean();
          if (existingBooking) return reply.code(200).send({ success: true, data: { request: doc, booking: existingBooking, message: 'Booking already exists for this request' } });
          // stale bookingId - clear it and continue to recreate
          doc.bookingId = undefined;
          await doc.save();
        } catch (e) {
          req.log?.warn?.('idempotency guard check failed', e?.message || e);
        }
      }

        // Determine price: prefer explicit selectedPrice from client, then artisan fixed quote,
        // then first option from artisan range, then client's budget.
        const selectedPrice = typeof updates.selectedPrice !== 'undefined' ? Number(updates.selectedPrice) : null;
        let price = null;
        if (selectedPrice && !Number.isNaN(selectedPrice) && Number(selectedPrice) > 0) price = selectedPrice;
        else if (doc.artisanReply?.quote) price = Number(doc.artisanReply.quote);
        else if (Array.isArray(doc.artisanReply?.options) && doc.artisanReply.options.length) price = Number(doc.artisanReply.options[0]);
        else price = (typeof doc.budget !== 'undefined' ? Number(doc.budget) : null);
        if (!price || Number.isNaN(price) || Number(price) <= 0) return reply.code(400).send({ success: false, message: 'No valid price available to create booking' });

        // Defer Booking creation until payment is confirmed by gateway.
        // Mark request as accepted and initialize payment (metadata will include specialRequestId).
        doc.status = 'accepted';
        doc.updatedAt = new Date();
        await doc.save();

        let paymentInit = null;
        try {
          if (process.env.PAYSTACK_SECRET_KEY) {
            const email = req.user?.email || req.body?.email || null;
            req.log?.info?.({ reqId: req.id, specialRequestId: String(doc._id), action: 'accept-init-payment', emailProvided: !!email, selectedPrice: price }, 'special request accept: payment init attempt');
            if (!email) {
              // create a pending Transaction record so there is a local trace (email can be supplied later)
              const tx = await Transaction.create({ specialRequestId: doc._id, payerId: req.user?.id || null, amount: Number(price) || 0, status: 'pending', paymentGatewayRef: null });
              req.log?.info?.({ reqId: req.id, specialRequestId: String(doc._id), txId: tx._id, amount: Number(price) || 0 }, 'created pending Transaction because email not available');
            } else {
              const amountInKobo = Math.round(Number(price) * 100);
              const initPayload = { email, amount: amountInKobo, metadata: { specialRequestId: String(doc._id), selectedPrice: Number(price) } };
              req.log?.info?.({ reqId: req.id, specialRequestId: String(doc._id), initPayload }, 'calling paystack initialize for special request');
              const res = await axios.post('https://api.paystack.co/transaction/initialize', initPayload, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } });
              paymentInit = res?.data?.data || null;
              req.log?.info?.({ reqId: req.id, specialRequestId: String(doc._id), paymentInit }, 'paystack initialize response for special request');
              if (paymentInit) {
                const tx = await Transaction.create({ specialRequestId: doc._id, payerId: req.user?.id || null, amount: Number(price) || 0, status: 'pending', paymentGatewayRef: paymentInit.reference });
                req.log?.info?.({ reqId: req.id, specialRequestId: String(doc._id), txId: tx._id, paymentReference: paymentInit.reference }, 'created Transaction from paystack init');
              }
            }
          }
        } catch (e) {
          req.log?.warn?.('payment initialization failed for special request (deferred booking flow)', e?.response?.data || e?.message || e);
        }

        // notify parties that payment is required to create booking
        const notifyArtisanTask = createNotification(req.server, doc.artisanId, { title: 'Request accepted — payment pending', body: `Client accepted your quote. Awaiting payment to create booking.`, payload: { type: 'special_request', requestId: String(doc._id) } }).catch(e => req.log?.warn?.('notify artisan failed', e?.message || e));
        const notifyClientTask = createNotification(req.server, doc.clientId, { title: 'Payment required', body: `Please complete payment to confirm booking for request ${doc._id}.`, payload: { type: 'special_request', requestId: String(doc._id) } }).catch(e => req.log?.warn?.('notify client failed', e?.message || e));
        await Promise.allSettled([notifyArtisanTask, notifyClientTask]);

        return reply.code(200).send({ success: true, data: { request: doc, booking: null, payment: paymentInit } });
    }

    // Generic updates allowed for owner (client) or artisan on their fields
    const allowed = ['title','description','location','date','time','urgency','budget','attachments','status'];
    let changed = false;
    for (const k of allowed) {
      if (typeof updates[k] !== 'undefined') {
        doc[k] = updates[k];
        changed = true;
      }
    }
    if (changed) {
      doc.updatedAt = new Date();
      await doc.save();
    }
    return reply.send({ success: true, data: doc });
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to update request' });
  }
};

// Artisan create/update response (idempotent)
export const respondToSpecialServiceRequest = async (req, reply) => {
  try {
    const id = req.params.id;
    const updates = req.body || {};
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });

    const doc = await SpecialServiceRequest.findById(id);
    if (!doc) return reply.code(404).send({ success: false, message: 'Not found' });

    // Ensure actor is the artisan (lightweight lookup)
    let artisan = null;
    try { artisan = await Artisan.findOne({ userId }).select('userId').lean(); } catch (e) { }
    const actorId = artisan ? String(artisan.userId) : String(userId);
    if (String(doc.artisanId) !== String(actorId)) return reply.code(403).send({ success: false, message: 'Forbidden' });

    // Parse note if JSON - support fixed or range quotes
    if (updates.note) {
      try {
        const parsed = typeof updates.note === 'string' ? JSON.parse(updates.note) : updates.note;
        doc.artisanReply = doc.artisanReply || {};
        // message
        if (parsed.message) doc.artisanReply.message = parsed.message;

        // fixed quote
        if (typeof parsed.quote !== 'undefined') {
          doc.artisanReply.quoteType = 'fixed';
          doc.artisanReply.quote = Number(parsed.quote);
          doc.artisanReply.minQuote = undefined;
          doc.artisanReply.maxQuote = undefined;
          doc.artisanReply.options = [];
        }

        // range quote (accept keys min/max or minQuote/maxQuote)
        const minRaw = parsed.min ?? parsed.minQuote ?? parsed.min_amount ?? parsed.minAmount;
        const maxRaw = parsed.max ?? parsed.maxQuote ?? parsed.max_amount ?? parsed.maxAmount;
        if (typeof minRaw !== 'undefined' && typeof maxRaw !== 'undefined') {
          const minV = Number(minRaw);
          const maxV = Number(maxRaw);
          if (!Number.isNaN(minV) && !Number.isNaN(maxV) && minV < maxV) {
            doc.artisanReply.quoteType = 'range';
            doc.artisanReply.minQuote = minV;
            doc.artisanReply.maxQuote = maxV;
            // generate 5 options evenly spaced
            const opts = [];
            for (let i = 0; i < 5; i++) {
              opts.push(Math.round(minV + (i * (maxV - minV) / 4)));
            }
            doc.artisanReply.options = opts;
            // clear fixed quote
            doc.artisanReply.quote = undefined;
          }
        }
      } catch (e) {
        doc.artisanReply = doc.artisanReply || {};
        doc.artisanReply.message = String(updates.note);
      }
    }
    // Normalize urgency if provided
    if (typeof updates.urgency !== 'undefined') {
      const u = updates.urgency;
      const s = String(u).trim().toLowerCase();
      if (s === 'high' || s === 'urgent') doc.urgency = 'High';
      else if (s === 'low') doc.urgency = 'Low';
      else doc.urgency = 'Normal';
    }
    doc.artisanReply = doc.artisanReply || {};
    doc.artisanReply.responseAt = new Date();
    doc.artisanReply.artisanId = String(doc.artisanId);
    doc.status = 'responded';
    doc.updatedAt = new Date();
    await doc.save();

    // notify client
    try {
      await createNotification(req.server, doc.clientId, {
        title: 'Your request has a response',
        body: `Artisan responded to your special service request`,
        payload: { type: 'special_request', requestId: String(doc._id) }
      });
    } catch (e) { req.log?.warn?.('notify client failed', e?.message || e); }

    return reply.send({ success: true, data: doc });
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to respond to request' });
  }
};

// Initialize payment for a special service request's booking
export const payForSpecialService = async (req, reply) => {
  try {
    const id = req.params.id;
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });

    const doc = await SpecialServiceRequest.findById(id).lean();
    if (!doc) return reply.code(404).send({ success: false, message: 'Special request not found' });
    req.log?.info?.({ reqId: req.id, route: 'payForSpecialService', params: req.params, body: req.body, userId, docBookingId: doc?.bookingId }, 'payForSpecialService called');

    // If booking doesn't exist yet, support deferred flow: initialize payment against the special request
    if (!doc.bookingId) {
      // only the request owner (client) may initialize payment for a deferred request
      if (String(doc.clientId) !== String(userId)) return reply.code(403).send({ success: false, message: 'Forbidden' });

      // Determine price: prefer explicit selectedPrice in body, then artisanReply.quote, then first option, then budget
      const selectedPriceBody = typeof req.body?.selectedPrice !== 'undefined' ? Number(req.body.selectedPrice) : null;
      let price = null;
      if (selectedPriceBody && !Number.isNaN(selectedPriceBody) && Number(selectedPriceBody) > 0) price = selectedPriceBody;
      else if (doc.artisanReply?.quote) price = Number(doc.artisanReply.quote);
      else if (Array.isArray(doc.artisanReply?.options) && doc.artisanReply.options.length) price = Number(doc.artisanReply.options[0]);
      else price = (typeof doc.budget !== 'undefined' ? Number(doc.budget) : null);
      if (!price || Number.isNaN(price) || Number(price) <= 0) return reply.code(400).send({ success: false, message: 'No valid price available to initialize payment' });

      if (!process.env.PAYSTACK_SECRET_KEY) {
        // create a pending Transaction so there is a local record and instruct client to retry when Paystack available
        try { await Transaction.create({ specialRequestId: doc._id, payerId: userId || null, amount: Number(price) || 0, status: 'pending', paymentGatewayRef: null }); } catch (e) { req.log?.warn?.('failed to create pending tx for deferred pay init', e?.message || e); }
        return reply.code(500).send({ success: false, message: 'Paystack not configured' });
      }

      const email = req.body?.email || req.user?.email || null;
      // if no email, create pending Transaction and return payment:null (client should prompt for email and retry)
      if (!email) {
        try { const tx = await Transaction.create({ specialRequestId: doc._id, payerId: userId || null, amount: Number(price) || 0, status: 'pending', paymentGatewayRef: null }); req.log?.info?.({ reqId: req.id, specialRequestId: String(doc._id), txId: tx._id }, 'created pending Transaction because email not available for deferred pay'); } catch (e) { req.log?.warn?.('failed to create pending tx when no email for deferred pay', e?.message || e); }
        return reply.code(200).send({ success: true, data: { request: doc, booking: null, payment: null } });
      }

      // initialize Paystack transaction for special request (metadata includes specialRequestId and selectedPrice)
      try {
        const amountInKobo = Math.round(Number(price) * 100);
        const initPayload = { email, amount: amountInKobo, metadata: { specialRequestId: String(doc._id), selectedPrice: Number(price) } };
        req.log?.info?.({ reqId: req.id, specialRequestId: String(doc._id), initPayload }, 'calling paystack initialize for special request (deferred)');
        const res = await axios.post('https://api.paystack.co/transaction/initialize', initPayload, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } });
        const init = res?.data?.data || null;
        req.log?.info?.({ reqId: req.id, specialRequestId: String(doc._id), paymentInit: init }, 'paystack initialize response for special request');
        if (init) {
          const tx = await Transaction.create({ specialRequestId: doc._id, payerId: userId || null, amount: Number(price) || 0, status: 'pending', paymentGatewayRef: init.reference });
          req.log?.info?.({ reqId: req.id, txId: tx._id, paymentReference: init.reference }, 'created Transaction from paystack init (deferred special request)');
        }
        return reply.code(201).send({ success: true, data: { request: doc, booking: null, payment: init } });
      } catch (e) {
        req.log?.error?.({ message: 'paystack initialize failed (deferred special request)', specialRequestId: String(doc._id), response: e?.response?.data || null, err: e?.message || e });
        const pd = e?.response?.data;
        if (pd && pd.code === 'amount_exceed_limit') return reply.code(400).send({ success: false, message: pd.message || 'Amount cannot be processed online; reduce the amount or use another payment method', detail: pd.meta || null });
        return reply.code(500).send({ success: false, message: 'Failed to initialize payment' });
      }
    }
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to initialize payment for special request' });
  }
};

export default {
  createSpecialServiceRequest,
  listSpecialServiceRequests,
  getSpecialServiceRequest,
  updateSpecialServiceRequest,
  respondToSpecialServiceRequest,
  payForSpecialService,
};
