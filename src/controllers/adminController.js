import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Transaction from '../models/Transaction.js';
import Admin from '../models/Admin.js';
import bcrypt from 'bcryptjs';
import Job from '../models/Job.js';
import mongoose from 'mongoose';
import Artisan from '../models/Artisan.js';
import Quote from '../models/Quote.js';
import Review from '../models/Review.js';
// Transaction is already imported above
import Wallet from '../models/Wallet.js';
import { createNotification } from '../utils/notifier.js';
const Kyc = (await import('../models/Kyc.js')).default;

function computeProfileCompletion(user = {}, artisan = {}) {
  try {
    // user fields considered
    const userFields = [
        !!(user.name && String(user.name).trim()) || false,
        !!(user.email && String(user.email).trim()) || false,
        !!(user.phone && String(user.phone).trim()) || false,
        !!(user.profileImage && user.profileImage.url) || false,
        !!user.kycVerified || false,
    ];
    const userPresent = userFields.filter(Boolean).length;
    const userTotal = userFields.length;

    // artisan-specific fields
    const artisanFields = [
      Array.isArray(artisan.trade) && artisan.trade.length > 0,
      typeof artisan.experience === 'number' && !isNaN(artisan.experience),
      !!(artisan.bio && String(artisan.bio).trim()),
      Array.isArray(artisan.portfolio) && artisan.portfolio.length > 0,
      Array.isArray(artisan.serviceArea?.coordinates) && artisan.serviceArea.coordinates.length >= 2,
      !!(artisan.pricing && (artisan.pricing.perJob || artisan.pricing.perHour)),
    ];
    const artPresent = artisanFields.filter(Boolean).length;
    const artTotal = artisanFields.length;

    // If artisan record exists, compute across both; otherwise compute just user side
    if (artisan && Object.keys(artisan).length) {
      const total = userTotal + artTotal;
      const present = userPresent + artPresent;
      return Math.round((present / total) * 100);
    }
    // only user
    return Math.round((userPresent / userTotal) * 100);
  } catch (e) {
    return 0;
  }
}

export async function adminOverview(request, reply) {
  try {
    const usersCount = await User.countDocuments();
    const bookingsCount = await Booking.countDocuments();
    const revenue = await Transaction.aggregate([
      { $match: { status: 'released' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return reply.send({ success: true, data: { users: usersCount, bookings: bookingsCount, revenue: revenue[0]?.total || 0 } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to fetch overview' });
  }
}

export async function listUsers(request, reply) {
  try {
    const { page = 1, limit = 50 } = request.query || {};
    const users = await User.find()
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });
    return reply.send({ success: true, data: users });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list users' });
  }
}

// Admin: List artisans with enriched user + artisan profile + kyc data
export async function listArtisans(request, reply) {
  try {
    const { page = 1, limit = 50, q } = request.query || {};
    const filter = { role: 'artisan' };
    if (q) {
      const re = new RegExp(String(q), 'i');
      filter.$or = [{ name: re }, { email: re }];
    }

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 })
      .lean();

    if (!users.length) return reply.send({ success: true, data: [], meta: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) } });

    const userIds = users.map(u => String(u._id));

    // fetch artisan profiles and kycs in batches
    const artisans = await Artisan.find({ userId: { $in: userIds } }).lean();
    const kycs = await Kyc.find({ userId: { $in: userIds } }).lean();

    const artisanByUser = {};
    for (const a of artisans) artisanByUser[String(a.userId)] = a;
    const kycByUser = {};
    for (const k of kycs) kycByUser[String(k.userId)] = k;

    const out = users.map(u => {
      const uid = String(u._id);
      const art = artisanByUser[uid] || null;
      const kyc = kycByUser[uid] || null;
      return {
        ...u,
        artisan: art,
        kyc: kyc,
        // convenience flags for admin UI
        isVerified: !!(u.kycVerified || u.isVerified || (art && art.verified)),
        profileCompletion: computeProfileCompletion(u, art || {}),
      };
    });

    return reply.send({ success: true, data: out, meta: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list artisans' });
  }
}

export async function updateUserRole(request, reply) {
  try {
    const { id } = request.params;
    const { role } = request.body || {};
    if (!role) return reply.code(400).send({ success: false, message: 'role required' });
    const user = await User.findByIdAndUpdate(id, { role }, { new: true });
    if (!user) return reply.code(404).send({ success: false, message: 'User not found' });
    return reply.send({ success: true, data: user });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to update role' });
  }
}

export async function banUser(request, reply) {
  try {
    const { id } = request.params;
    const user = await User.findByIdAndUpdate(id, { banned: true }, { new: true });
    if (!user) return reply.code(404).send({ success: false, message: 'User not found' });
    // notify user and send email if configured
    try {
      await createNotification(request.server, user._id, {
        type: 'ban',
        title: 'Account suspended',
        body: `Your account has been suspended by the admin. Contact support for details.`,
        data: { sendEmail: true, email: user.email }
      });
    } catch (e) {
      request.log?.warn?.('ban notification failed', e?.message || e);
    }
    return reply.send({ success: true, data: user });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to ban user' });
  }
}

export async function unbanUser(request, reply) {
  try {
    const { id } = request.params;
    const user = await User.findByIdAndUpdate(id, { banned: false }, { new: true });
    if (!user) return reply.code(404).send({ success: false, message: 'User not found' });
    // notify user and send email if configured
    try {
      await createNotification(request.server, user._id, {
        type: 'unban',
        title: 'Account reactivated',
        body: `Your account has been reactivated. You can now sign in.`,
        data: { sendEmail: true, email: user.email }
      });
    } catch (e) {
      request.log?.warn?.('unban notification failed', e?.message || e);
    }
    return reply.send({ success: true, data: user });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to unban user' });
  }
}

export async function createAdmin(request, reply) {
  try {
    const { name, email, password, permissions } = request.body || {};
    if (!email || !password) return reply.code(400).send({ success: false, message: 'email and password required' });
    const exists = await Admin.findOne({ email });
    if (exists) return reply.code(409).send({ success: false, message: 'Admin already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const admin = await Admin.create({ name, email, password: hashed, permissions: permissions || undefined });
    return reply.code(201).send({ success: true, data: { id: admin._id, email: admin.email, name: admin.name } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to create admin' });
  }
}

// List all admins (admin only)
export async function listAdmins(request, reply) {
  try {
    const { page = 1, limit = 50 } = request.query || {};
    
    const admins = await Admin.find({}, '-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();

    const total = await Admin.countDocuments();

    return reply.send({
      success: true,
      data: admins,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list admins' });
  }
}

export async function adminListJobs(request, reply) {
  try {
    const { page = 1, limit = 50, status, clientId, groupBy } = request.query || {};

    // Admin-only: support aggregation by user when requested
    if (groupBy === 'user') {
      const pipeline = [
        { $match: clientId ? { clientId: mongoose.Types.ObjectId(clientId) } : {} },
        { $group: { _id: '$clientId', totalJobs: { $sum: 1 }, lastCreated: { $max: '$createdAt' } } },
        { $sort: { totalJobs: -1 } },
      ];
      const summary = await Job.aggregate(pipeline);
      return reply.send({ success: true, data: summary });
    }

    const filters = {};
    if (status) filters.status = status;
    if (clientId) filters.clientId = clientId;

    const jobs = await Job.find(filters)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });
    const total = await Job.countDocuments(filters);
    return reply.send({ success: true, data: jobs, meta: { page: Number(page), limit: Number(limit), total } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list jobs' });
  }
}

export async function centralFeed(request, reply) {
  try {
    const user = request.user || {};
    const role = user.role || 'user';
    const userId = user.id;

    const limit = Number(request.query.limit) || 20;

    // Common summaries
    const bookingsCount = await Booking.countDocuments();
    const usersCount = await (await import('../models/User.js')).default.countDocuments();
    const artisansCount = await Artisan.countDocuments();
    const transactionsTotal = await Transaction.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);

      // include wallet-based totals (top artisans by totalJobs)
      const topArtisansByJobs = await Wallet.find().sort({ totalJobs: -1 }).limit(10).populate('userId', 'name profileImage email phone kycVerified isVerified').lean();

      // fetch artisan profiles for these users to compute completion and verification flags
      const topUserIds = topArtisansByJobs.map(w => w.userId && w.userId._id).filter(Boolean);
      const artisansForTop = await Artisan.find({ userId: { $in: topUserIds } }).lean();
      const artisanByUserId = {};
      for (const a of artisansForTop) artisanByUserId[String(a.userId)] = a;

      const summary = {
        counts: {
          users: usersCount,
          artisans: artisansCount,
          bookings: bookingsCount,
          transactionsTotal: transactionsTotal[0]?.total || 0,
        },
        topArtisansByJobs: topArtisansByJobs.map(w => {
          const u = w.userId || {};
          const artisan = artisanByUserId[String(u._id)] || null;
          const isVerified = !!(u.kycVerified || u.isVerified || (artisan && artisan.verified));
          const profileCompletion = computeProfileCompletion(u, artisan);
          return { user: u, totalJobs: w.totalJobs, totalEarned: w.totalEarned, balance: w.balance, isVerified, profileCompletion };
        }),
      };

    // Role-specific payloads
    if (role === 'admin') {
      // Use lean() + projections and batch-resolve users to reduce Mongoose overhead
      const recentBookings = await Booking.find().sort({ createdAt: -1 }).limit(limit)
        .select('service schedule status price customerId artisanId createdAt')
        .lean();

      // batch resolve users for bookings
      const bookingUserIds = [...new Set(recentBookings.flatMap(b => [String(b.customerId || ''), String(b.artisanId || '')]).filter(Boolean))];
      const UserModel = (await import('../models/User.js')).default;
      const usersForBookings = bookingUserIds.length ? await UserModel.find({ _id: { $in: bookingUserIds } }, 'name email profileImage role kycVerified isVerified').lean() : [];
      const usersMap = {};
      for (const u of usersForBookings) usersMap[String(u._id)] = u;
      for (const b of recentBookings) {
        b.customer = usersMap[String(b.customerId)] || null;
        b.artisan = usersMap[String(b.artisanId)] || null;
      }

      const recentUsers = await UserModel.find().sort({ createdAt: -1 }).limit(20).select('name email profileImage role kycVerified isVerified').lean();

      const recentTransactions = await Transaction.find().sort({ createdAt: -1 }).limit(limit)
        .select('payerId payeeId amount status createdAt paymentGatewayRef')
        .lean();
      const txUserIds = [...new Set(recentTransactions.flatMap(t => [String(t.payerId || ''), String(t.payeeId || '')]).filter(Boolean))];
      const txUsers = txUserIds.length ? await UserModel.find({ _id: { $in: txUserIds } }, 'name email profileImage').lean() : [];
      const txUsersMap = {}; for (const u of txUsers) txUsersMap[String(u._id)] = u;
      for (const t of recentTransactions) { t.payer = txUsersMap[String(t.payerId)] || null; t.payee = txUsersMap[String(t.payeeId)] || null; }

      const recentQuotes = await Quote.find().sort({ createdAt: -1 }).limit(limit)
        .select('artisanId customerId bookingId jobId total status createdAt')
        .lean();
      const quoteUserIds = [...new Set(recentQuotes.flatMap(q => [String(q.artisanId || ''), String(q.customerId || '')]).filter(Boolean))];
      const quoteUsers = quoteUserIds.length ? await UserModel.find({ _id: { $in: quoteUserIds } }, 'name email profileImage').lean() : [];
      const quoteUsersMap = {}; for (const u of quoteUsers) quoteUsersMap[String(u._id)] = u;
      for (const q of recentQuotes) { q.artisan = quoteUsersMap[String(q.artisanId)] || null; q.customer = quoteUsersMap[String(q.customerId)] || null; }

      const recentJobs = await Job.find().sort({ createdAt: -1 }).limit(limit).select('title description budget status createdAt').lean();

      // attach basic profileCompletion/isVerified for recent users (lookup artisan entries)
      const recentUserIds = recentUsers.map(u => String(u._id));
      const recentArtisans = recentUserIds.length ? await Artisan.find({ userId: { $in: recentUserIds } }).lean() : [];
      const recentArtByUser = {};
      for (const a of recentArtisans) recentArtByUser[String(a.userId)] = a;
      for (const ru of recentUsers) {
          const art = recentArtByUser[String(ru._id)] || null;
          ru.isVerified = !!(ru.kycVerified || ru.isVerified || (art && art.verified));
          ru.profileCompletion = computeProfileCompletion(ru, art);
      }

      return reply.send({ success: true, data: { summary, recent: { bookings: recentBookings, users: recentUsers, transactions: recentTransactions, quotes: recentQuotes, jobs: recentJobs } } });
    }

    if (role === 'artisan') {
      const myBookings = await Booking.find({ artisanId: userId }).sort({ createdAt: -1 }).limit(limit).populate('customerId');
      const myQuotes = await Quote.find({ artisanId: userId }).sort({ createdAt: -1 }).limit(limit).populate('customerId');
      const myTransactions = await Transaction.find({ payeeId: userId }).sort({ createdAt: -1 }).limit(limit);
      const myReviews = await Review.find({ artisanId: userId }).sort({ createdAt: -1 }).limit(10);
      const myWallet = await Wallet.findOne({ userId }).lean();
      return reply.send({ success: true, data: { summary, mine: { bookings: myBookings, quotes: myQuotes, transactions: myTransactions, reviews: myReviews, wallet: myWallet } } });
    }

    // default: customer/user
    const myBookings = await Booking.find({ customerId: userId }).sort({ createdAt: -1 }).limit(limit).populate('artisanId');
    const myQuotes = await Quote.find({ customerId: userId }).sort({ createdAt: -1 }).limit(limit).populate('artisanId');
    const myTransactions = await Transaction.find({ payerId: userId }).sort({ createdAt: -1 }).limit(limit);
    return reply.send({ success: true, data: { summary, mine: { bookings: myBookings, quotes: myQuotes, transactions: myTransactions } } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to fetch central feed' });
  }
}

// Admin: List all bookings with filtering
export async function adminListBookings(request, reply) {
  try {
    const { page = 1, limit = 50, status, customerId, artisanId, sortBy = 'createdAt', includeDetails = 'true' } = request.query || {};
    const q = {};
    if (status) q.status = status;
    if (customerId) q.customerId = customerId;
    if (artisanId) q.artisanId = artisanId;

    const bookings = await Booking.find(q)
      .populate('customerId', 'name email phone profileImage')
      .populate('artisanId', 'name email phone profileImage')
      .populate('acceptedQuote')
      .sort({ [sortBy]: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();

    const total = await Booking.countDocuments(q);

    // If includeDetails is true, fetch quotes and job for each booking
    if (includeDetails === 'true') {
      const bookingIds = bookings.map(b => b._id);
      
      // Fetch all quotes for these bookings
      const quotes = await Quote.find({ bookingId: { $in: bookingIds } })
        .populate('artisanId', 'name email profileImage')
        .lean();
      
      // Group quotes by bookingId
      const quotesByBooking = {};
      const jobIds = new Set();
      for (const quote of quotes) {
        const bId = String(quote.bookingId);
        if (!quotesByBooking[bId]) quotesByBooking[bId] = [];
        quotesByBooking[bId].push(quote);
        if (quote.jobId) jobIds.add(String(quote.jobId));
      }

      // Fetch jobs if any jobIds found
      let jobsMap = {};
      if (jobIds.size > 0) {
        const Job = (await import('../models/Job.js')).default;
        const jobs = await Job.find({ _id: { $in: Array.from(jobIds) } })
          .populate('clientId', 'name email phone')
          .lean();
        for (const job of jobs) {
          jobsMap[String(job._id)] = job;
        }
      }

      // Attach quotes and job to each booking
      for (const booking of bookings) {
        const bId = String(booking._id);
        booking.quotes = quotesByBooking[bId] || [];
        
        // Find associated job through quotes
        const jobQuote = booking.quotes.find(q => q.jobId);
        booking.job = jobQuote && jobQuote.jobId ? jobsMap[String(jobQuote.jobId)] : null;
      }
    }

    return reply.send({ 
      success: true, 
      data: bookings,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list bookings' });
  }
}

// Admin: List all quotes with filtering
export async function adminListQuotes(request, reply) {
  try {
    const { page = 1, limit = 50, status, customerId, artisanId, bookingId, jobId, type, sortBy = 'createdAt' } = request.query || {};
    const q = {};
    if (status) q.status = status;
    if (customerId) q.customerId = customerId;
    if (artisanId) q.artisanId = artisanId;
    if (bookingId) q.bookingId = bookingId;
    if (jobId) q.jobId = jobId;
    
    // Filter by quote type: 'booking' (has bookingId), 'job' (has jobId), or 'all'
    if (type === 'booking') {
      q.bookingId = { $exists: true, $ne: null };
    } else if (type === 'job') {
      q.jobId = { $exists: true, $ne: null };
    }

    const quotes = await Quote.find(q)
      .populate('customerId', 'name email phone profileImage')
      .populate('artisanId', 'name email phone profileImage')
      .populate('bookingId', 'service schedule status price paymentStatus')
      .populate('jobId', 'title description budget category status location')
      .sort({ [sortBy]: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();

    const total = await Quote.countDocuments(q);

    // Add a helper field to easily identify quote type
    const enrichedQuotes = quotes.map(quote => ({
      ...quote,
      quoteType: quote.bookingId ? 'booking' : quote.jobId ? 'job' : 'unknown',
      context: quote.bookingId ? 'Direct hire - artisan negotiating price for existing booking' :
               quote.jobId ? 'Job posting - artisan bidding on open job' : 
               'Unknown'
    }));

    return reply.send({ 
      success: true, 
      data: enrichedQuotes,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list quotes' });
  }
}

// Admin: List all chats with filtering
export async function adminListChats(request, reply) {
  try {
    const { page = 1, limit = 50, bookingId, userId, includeMessages = 'true', sortBy = 'createdAt' } = request.query || {};
    const q = {};
    
    if (bookingId) q.bookingId = bookingId;
    if (userId) q.participants = userId; // MongoDB will match if userId is in the participants array

    const chats = await Chat.find(q)
      .populate('bookingId', 'service schedule status price customerId artisanId')
      .populate('participants', 'name email phone profileImage role')
      .sort({ [sortBy]: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();

    const total = await Chat.countDocuments(q);

    // Optionally populate message senders for full context
    if (includeMessages === 'true') {
      const User = (await import('../models/User.js')).default;
      
      for (const chat of chats) {
        // Collect unique sender IDs from messages
        const senderIds = [...new Set((chat.messages || []).map(m => String(m.senderId)).filter(Boolean))];
        
        // Fetch sender details
        const senders = await User.find({ _id: { $in: senderIds } }, 'name profileImage role').lean();
        const sendersMap = {};
        for (const s of senders) {
          sendersMap[String(s._id)] = s;
        }
        
        // Enrich messages with sender details
        chat.messages = (chat.messages || []).map(m => {
          const sender = sendersMap[String(m.senderId)];
          return {
            _id: m._id,
            senderId: m.senderId,
            senderName: sender?.name || 'Unknown',
            senderRole: sender?.role || null,
            senderImageUrl: sender?.profileImage?.url || null,
            message: m.message,
            timestamp: m.timestamp,
            seen: m.seen
          };
        });
      }
    } else {
      // If not including full messages, just return message count
      for (const chat of chats) {
        chat.messageCount = chat.messages?.length || 0;
        delete chat.messages; // Remove messages array to reduce payload
      }
    }

    return reply.send({ 
      success: true, 
      data: chats,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list chats' });
  }
}

// Admin: Get specific chat by ID with full details
export async function adminGetChat(request, reply) {
  try {
    const { id } = request.params;
    
    const chat = await Chat.findById(id)
      .populate('bookingId')
      .populate('participants', 'name email phone profileImage role')
      .lean();

    if (!chat) return reply.code(404).send({ success: false, message: 'Chat not found' });

    // Populate message senders
    const User = (await import('../models/User.js')).default;
    const senderIds = [...new Set((chat.messages || []).map(m => String(m.senderId)).filter(Boolean))];
    const senders = await User.find({ _id: { $in: senderIds } }, 'name profileImage role').lean();
    const sendersMap = {};
    for (const s of senders) {
      sendersMap[String(s._id)] = s;
    }
    
    // Enrich messages
    chat.messages = (chat.messages || []).map(m => {
      const sender = sendersMap[String(m.senderId)];
      return {
        _id: m._id,
        senderId: m.senderId,
        senderName: sender?.name || 'Unknown',
        senderRole: sender?.role || null,
        senderImageUrl: sender?.profileImage?.url || null,
        message: m.message,
        timestamp: m.timestamp,
        seen: m.seen
      };
    });

    // If booking exists, get customer and artisan details
    if (chat.bookingId) {
      const booking = chat.bookingId;
      const customerUser = chat.participants.find(p => String(p._id) === String(booking.customerId));
      const artisanUser = chat.participants.find(p => String(p._id) === String(booking.artisanId));
      
      chat.bookingDetails = {
        ...booking,
        customer: customerUser || null,
        artisan: artisanUser || null
      };
    }

    return reply.send({ success: true, data: chat });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get chat' });
  }
}

// Admin: List all wallets with user details
export async function adminListWallets(request, reply) {
  try {
    const { page = 1, limit = 50, sortBy = 'balance', sortOrder = 'desc', minBalance, role } = request.query || {};
    
    const q = {};
    if (minBalance) q.balance = { $gte: Number(minBalance) };

    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    let wallets = await Wallet.find(q)
      .populate('userId', 'name email phone profileImage role kycVerified isVerified')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();

    // Filter by role if specified
    if (role) {
      wallets = wallets.filter(w => w.userId?.role === role);
    }

    const total = await Wallet.countDocuments(q);

    return reply.send({ 
      success: true, 
      data: wallets,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list wallets' });
  }
}

// Admin: Get specific wallet by user ID
export async function adminGetWallet(request, reply) {
  try {
    const { userId } = request.params;
    
    const wallet = await Wallet.findOne({ userId })
      .populate('userId', 'name email phone profileImage role kycVerified isVerified createdAt')
      .lean();

    if (!wallet) return reply.code(404).send({ success: false, message: 'Wallet not found' });

    // Get related transactions for this user
    const Transaction = (await import('../models/Transaction.js')).default;
    const recentTransactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    wallet.recentTransactions = recentTransactions;

    // Get wallet statistics
    wallet.statistics = {
      totalEarnings: wallet.totalEarned || 0,
      totalSpending: wallet.totalSpent || 0,
      currentBalance: wallet.balance || 0,
      netActivity: (wallet.totalEarned || 0) - (wallet.totalSpent || 0),
      completedJobs: wallet.totalJobs || 0,
      hasPayoutDetails: !!(wallet.payoutDetails?.account_number && wallet.payoutDetails?.bank_code),
      paystackRecipientCode: wallet.paystackRecipientCode || null
    };

    return reply.send({ success: true, data: wallet });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get wallet' });
  }
}
