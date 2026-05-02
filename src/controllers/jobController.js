import Job from '../models/Job.js';
import Application from '../models/Application.js';
import Booking from '../models/Booking.js';
import Quote from '../models/Quote.js';
import Chat from '../models/Chat.js';
import { createNotification } from '../utils/notifier.js';
import { notifyArtisansAboutJob } from '../utils/notifier.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cloudinary from '../utils/cloudinary.js';
import { normalizePaymentMode } from '../utils/paymentMode.js';
const JobCategory = (await import('../models/JobCategory.js')).default;
const User = (await import('../models/User.js')).default;

export async function createJob(request, reply) {
  try {
    const payload = request.body || {};
    if (request.user && request.user.id) payload.clientId = request.user.id;
    // validate categoryId if provided
    if (payload.categoryId) {
      // lazy import to avoid cycles
      const cat = await JobCategory.findById(payload.categoryId);
      if (!cat) return reply.code(400).send({ success: false, message: 'Invalid categoryId' });
    }
    // normalize coordinates if provided as object
    if (payload.coordinates && Array.isArray(payload.coordinates) === false && payload.coordinates.lat && payload.coordinates.lon) {
      payload.coordinates = [payload.coordinates.lon, payload.coordinates.lat];
    }
    const job = await Job.create(payload);
    // Fire-and-forget: notify artisans about new job (filter by trade if available)
    try {
      // send emails to artisans if enabled via env var JOB_NOTIFY_EMAILS (default true)
      const sendEmail = String(process.env.JOB_NOTIFY_EMAILS || 'true').toLowerCase() === 'true';
      // don't block response — notify in background
      notifyArtisansAboutJob(request.server, job, { tradeFilter: job.trade || [], sendEmail }).catch(err => request.log?.warn?.('artisan notify failed', err?.message || err));
    } catch (e) {
      request.log?.warn?.('schedule notify failed', e?.message || e);
    }
    return reply.code(201).send({ success: true, data: job });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function listJobs(request, reply) {
  try {
    const { page = 1, limit = 20, trade, categoryId, lat, lon, radiusKm = 50, q } = request.query || {};
    const { status, mine } = request.query || {};
    const isAdmin = request.user?.role === 'admin';
    
    let filters = {};
    if (String(mine) === 'true') {
      const userId = request.user?.id;
      if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required to list your jobs' });
      filters.clientId = userId;
      if (status) filters.status = status;
    } else {
      // Admins see all jobs (all statuses) unless status filter is explicitly provided
      // Regular users only see 'open' jobs by default
      if (status) {
        filters.status = status;
      } else if (!isAdmin) {
        filters.status = 'open';
      }
      // If isAdmin and no status provided, don't filter by status (show all)
    }
    if (trade) filters.trade = { $in: [new RegExp(`^${trade}$`, 'i')] };
    if (categoryId) filters.categoryId = categoryId;
    if (q) filters.$or = [{ title: { $regex: q, $options: 'i' } }, { description: { $regex: q, $options: 'i' } }];

    // geo search when lat/lon provided
    if (lat && lon) {
      const latN = Number(lat);
      const lonN = Number(lon);
      filters.coordinates = { $near: { $geometry: { type: 'Point', coordinates: [lonN, latN] }, $maxDistance: Number(radiusKm) * 1000 } };
    }

    const jobs = await Job.find(filters)
      .select('title description schedule budget status createdAt clientId categoryId coordinates trade')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 })
      .lean();
    
    // If requester is admin, populate client details and category details
    if (isAdmin) {
      // const JobCategory = (await import('../models/JobCategory.js')).default;
      
      // Filter out null/undefined BEFORE converting to string
      const clientIds = [...new Set(jobs.map(j => j.clientId).filter(id => id != null).map(id => String(id)))];
      const categoryIds = [...new Set(jobs.map(j => j.categoryId).filter(id => id != null).map(id => String(id)))];
      
      // Fetch clients
      let clientsMap = {};
      if (clientIds.length) {
        const clients = await User.find({ _id: { $in: clientIds } }, 'name email phone profileImage').lean();
        for (const c of clients) clientsMap[String(c._id)] = c;
      }
      
      // Fetch categories
      let categoriesMap = {};
      if (categoryIds.length) {
        const categories = await JobCategory.find({ _id: { $in: categoryIds } }, 'name slug description').lean();
        for (const cat of categories) categoriesMap[String(cat._id)] = cat;
      }

      const jobsWithDetails = jobs.map(job => {
        const clientId = String(job.clientId || '');
        const categoryId = String(job.categoryId || '');
        return {
          ...job,
          clientDetails: clientsMap[clientId] || null,
          categoryDetails: job.categoryId ? (categoriesMap[categoryId] || null) : null
        };
      });
      
      return reply.send({ success: true, data: jobsWithDetails });
    }
    
    // console.log(jobs);
    return reply.send({ success: true, data: jobs });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list jobs' });
  }
}

export async function getJob(request, reply) {
  try {
    const job = await Job.findByIdOrPublic(request.params.id);
    if (!job) return reply.code(404).send({ success: false, message: 'Not found' });
    return reply.send({ success: true, data: job });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get job' });
  }
}

export async function updateJob(request, reply) {
  try {
    const job = await Job.findByIdOrPublic(request.params.id);
    if (!job) return reply.code(404).send({ success: false, message: 'Job not found' });
    const userId = String(request.user?.id);
    if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });
    if (String(job.clientId) !== userId) return reply.code(403).send({ success: false, message: 'Forbidden' });

    const payload = request.body || {};
    // allowed updatable fields
    const allowed = ['title', 'description', 'trade', 'location', 'coordinates', 'budget', 'schedule', 'categoryId', 'experienceLevel'];

    // normalize coordinates if provided as object
    if (payload.coordinates && Array.isArray(payload.coordinates) === false && payload.coordinates.lat && payload.coordinates.lon) {
      payload.coordinates = [payload.coordinates.lon, payload.coordinates.lat];
    }

    for (const key of allowed) {
      if (payload[key] !== undefined) job[key] = payload[key];
    }

    // if categoryId was set, validate it
    if (payload.categoryId) {
      const JobCategory = (await import('../models/JobCategory.js')).default;
      const cat = await JobCategory.findById(payload.categoryId);
      if (!cat) return reply.code(400).send({ success: false, message: 'Invalid categoryId' });
    }

    // validate experienceLevel if provided
    if (payload.experienceLevel !== undefined) {
      const levels = ['entry', 'mid', 'senior'];
      if (!levels.includes(payload.experienceLevel)) return reply.code(400).send({ success: false, message: 'Invalid experienceLevel' });
    }

    await job.save();
    return reply.send({ success: true, data: job });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to update job' });
  }
}

export async function applyJob(request, reply) {
  try {
    const job = await Job.findByIdOrPublic(request.params.id);
    if (!job) return reply.code(404).send({ success: false, message: 'Job not found' });
    if (job.status !== 'open') return reply.code(400).send({ success: false, message: 'Job not open' });
    const payload = request.body || {};
    const artisanId = request.user?.id;
    if (!artisanId) return reply.code(401).send({ success: false, message: 'Authentication required' });
    // prevent duplicate application
    const existing = await Application.findOne({ jobId: job._id, artisanId });
    if (existing) return reply.code(400).send({ success: false, message: 'Already applied' });
    const appPayload = {
      jobId: job._id,
      artisanId,
      coverNote: payload.coverNote,
      proposedPrice: payload.proposedPrice,
    };
    if (payload.items && Array.isArray(payload.items)) appPayload.items = payload.items;
    if (payload.attachments && Array.isArray(payload.attachments)) appPayload.attachments = payload.attachments;

    const app = await Application.create(appPayload);
    // Also create or upsert a Quote for this job so the job's quotes list shows artisan proposals
    let createdOrUpdatedQuote = null;
    try {
      const existingQuote = await Quote.findOne({ jobId: job._id, artisanId });
      const total = Number(payload.proposedPrice || 0) || (Array.isArray(payload.items) ? payload.items.reduce((s, it) => s + (Number(it.cost || 0) * Number(it.qty || 1)), 0) : 0);
      if (existingQuote) {
        existingQuote.total = total || existingQuote.total;
        existingQuote.items = payload.items && Array.isArray(payload.items) ? payload.items : existingQuote.items;
        existingQuote.notes = payload.coverNote || existingQuote.notes || '';
        existingQuote.status = existingQuote.status || 'proposed';
        await existingQuote.save();
        createdOrUpdatedQuote = existingQuote;
      } else {
        createdOrUpdatedQuote = await Quote.create({ jobId: job._id, artisanId, customerId: job.clientId, items: payload.items && Array.isArray(payload.items) ? payload.items : [], serviceCharge: 0, notes: payload.coverNote || '', total, status: 'proposed' });
      }
    } catch (e) {
      request.log?.warn?.('create quote from application failed', e?.message || e);
    }
    // notify client
    try { await createNotification(request.server, job.clientId, { type: 'application', title: 'New application', body: `An artisan applied to your job: ${job.title}`, data: { jobId: job._id, applicationId: app._id, quoteId: createdOrUpdatedQuote?._id, sendEmail: true } }); } catch (e) { request.log?.warn?.('notify client failed', e?.message); }

    return reply.code(201).send({ success: true, data: { application: app, quote: createdOrUpdatedQuote } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function listApplications(request, reply) {
  try {
    const job = await Job.findByIdOrPublic(request.params.id);
    // console.log(job);
    if (!job) return reply.code(404).send({ success: false, message: 'Job not found' });
    // only client (owner) or admin should list
    if (String(request.user?.id) !== String(job.clientId)) return reply.code(403).send({ success: false, message: 'Forbidden' });
    const apps = await Application.find({ jobId: job._id }).sort({ createdAt: -1 });
    return reply.send({ success: true, data: apps });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list applications' });
  }
}

export async function acceptApplication(request, reply) {
  try {
    const { id: jobId, appId } = request.params;
    const job = await Job.findByIdOrPublic(jobId);
    if (!job) return reply.code(404).send({ success: false, message: 'Job not found' });
    if (String(request.user?.id) !== String(job.clientId)) return reply.code(403).send({ success: false, message: 'Forbidden' });
    const app = await Application.findById(appId);
    if (!app || String(app.jobId) !== String(job._id)) return reply.code(404).send({ success: false, message: 'Application not found' });
    app.status = 'accepted';
    await app.save();
    job.status = 'filled';
    await job.save();

    const requestedPaymentMode = normalizePaymentMode(request.body?.paymentMode) || 'upfront';
    if (typeof request.body?.paymentMode !== 'undefined' && requestedPaymentMode === null) {
      return reply.code(400).send({ success: false, message: 'Invalid paymentMode' });
    }

    const bookingStatus = requestedPaymentMode === 'afterCompletion' ? 'awaiting-acceptance' : 'pending';

    // create a booking when application accepted
    const booking = await Booking.create({
      customerId: job.clientId,
      artisanId: app.artisanId,
      service: job.title,
      schedule: job.schedule || new Date(),
      price: app.proposedPrice || job.budget || 0,
      status: bookingStatus,
      paymentStatus: 'unpaid',
      paymentMode: requestedPaymentMode,
    });

    // ensure chat exists for the booking so artisan/customer can communicate
    try {
      const chat = await Chat.create({ bookingId: booking._id, participants: [job.clientId, app.artisanId], messages: [] });
      booking.chatId = chat._id;
      await booking.save();
    } catch (e) {
      request.log?.warn?.('create booking chat failed', e?.message || e);
    }

    // notify artisan (send email to artisan's registered email if available)
    try {
      const User = (await import('../models/User.js')).default;
      const artisanUser = await User.findById(app.artisanId);
      const artisanEmail = artisanUser?.email;
      await createNotification(request.server, app.artisanId, { type: 'application', title: 'Application accepted', body: `Your application for job "${job.title}" was accepted.`, data: { bookingId: booking._id, sendEmail: true, email: artisanEmail } });
    } catch (e) { request.log?.warn?.('notify artisan failed', e?.message); }
    return reply.send({ success: true, data: { application: app, booking } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to accept application' });
  }
}

export async function deleteJob(request, reply) {
  try {
    const job = await Job.findByIdOrPublic(request.params.id);
    if (!job) return reply.code(404).send({ success: false, message: 'Not found' });
    // Allow job owner or admin to close the job
    const userId = String(request.user?.id);
    if (String(job.clientId) !== userId && request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, message: 'Forbidden' });
    }
    job.status = 'closed';
    await job.save();
    return reply.send({ success: true, message: 'Job closed' });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to close job' });
  }
}

export async function updateApplication(request, reply) {
  try {
    const { id: jobId, appId } = request.params;
    const app = await Application.findById(appId);
    if (!app || String(app.jobId) !== String(jobId)) return reply.code(404).send({ success: false, message: 'Application not found' });
    if (String(app.artisanId) !== String(request.user?.id)) return reply.code(403).send({ success: false, message: 'Forbidden' });
    const { coverNote, proposedPrice } = request.body || {};
    if (coverNote !== undefined) app.coverNote = coverNote;
    if (proposedPrice !== undefined) app.proposedPrice = proposedPrice;
    await app.save();
    return reply.send({ success: true, data: app });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to update application' });
  }
}

export async function withdrawApplication(request, reply) {
  try {
    const { id: jobId, appId } = request.params;
    const app = await Application.findById(appId);
    if (!app || String(app.jobId) !== String(jobId)) return reply.code(404).send({ success: false, message: 'Application not found' });
    if (String(app.artisanId) !== String(request.user?.id)) return reply.code(403).send({ success: false, message: 'Forbidden' });
    app.status = 'withdrawn';
    await app.save();
    return reply.send({ success: true, data: app });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to withdraw application' });
  }
}

// Upload an attachment for a job (client owner)
export async function uploadJobAttachment(request, reply) {
  try {
    // expect multipart/form-data with field 'file'
    const jobId = request.params.id;
    const job = await Job.findByIdOrPublic(jobId);
    if (!job) return reply.code(404).send({ success: false, message: 'Job not found' });
    if (String(job.clientId) !== String(request.user?.id)) return reply.code(403).send({ success: false, message: 'Forbidden' });
    // If a previous middleware already uploaded to Cloudinary, use those results
    if (request.uploadedFiles && request.uploadedFiles.length) {
      for (const f of request.uploadedFiles) {
        job.attachments = job.attachments || [];
        job.attachments.push({ url: f.url, public_id: f.public_id });
      }
      await job.save();
      return reply.send({ success: true, data: job.attachments });
    }

    // If client posted multipart parts, stream each part directly to Cloudinary (avoid buffering)
    if (request.isMultipart && typeof request.parts === 'function') {
      for await (const part of request.parts()) {
        if (part.file) {
          try {
            const res = await new Promise((resolve, reject) => {
              const uploadStream = cloudinary.uploader.upload_stream({ folder: 'jobs', resource_type: 'auto' }, (err, result) => {
                if (err) return reject(err);
                resolve(result);
              });
              part.file.pipe(uploadStream);
            });
            const url = res.secure_url || res.url;
            const public_id = res.public_id;
            if (url) {
              job.attachments = job.attachments || [];
              job.attachments.push({ url, public_id });
            }
          } catch (err) {
            request.log?.warn?.('cloudinary upload failed', err?.message || err);
          }
        }
      }
      await job.save();
      return reply.send({ success: true, data: job.attachments });
    }

    // fallback to buffered files populated by upload middleware
    const uploaded = request.uploadedFiles || [];
    if (!uploaded.length) return reply.code(400).send({ success: false, message: 'No file uploaded' });

    const streamUpload = (buffer, options = {}) => new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
      uploadStream.end(buffer);
    });

    for (const fileObj of uploaded) {
      const opts = { folder: 'jobs', resource_type: 'auto' };
      try {
        const res = await streamUpload(fileObj.buffer, opts);
        const url = res.secure_url || res.url;
        const public_id = res.public_id;
        if (url) {
          job.attachments = job.attachments || [];
          job.attachments.push({ url, public_id });
        }
      } catch (err) {
        request.log?.warn?.('cloudinary upload failed', err?.message || err);
      }
    }
    await job.save();
    return reply.send({ success: true, data: job.attachments });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to upload attachment' });
  }
}

export async function deleteJobAttachment(request, reply) {
  try {
    const jobId = request.params.id;
    const public_id = request.query.public_id;
    if (!public_id) return reply.code(400).send({ success: false, message: 'public_id query param required' });
    const job = await Job.findByIdOrPublic(jobId);
    if (!job) return reply.code(404).send({ success: false, message: 'Job not found' });
    // only owner or admin
    const userId = String(request.user?.id);
    if (String(job.clientId) !== userId && request.user?.role !== 'admin') return reply.code(403).send({ success: false, message: 'Forbidden' });

    try {
      await cloudinary.uploader.destroy(public_id, { resource_type: 'auto' });
    } catch (err) {
      request.log?.warn?.('cloudinary destroy failed', err?.message || err);
    }

    job.attachments = (job.attachments || []).filter(a => a.public_id !== public_id);
    await job.save();
    return reply.send({ success: true, message: 'Attachment removed', data: job.attachments });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to delete attachment' });
  }
}
