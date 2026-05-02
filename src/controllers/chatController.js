import Chat from '../models/Chat.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import { createNotification } from '../utils/notifier.js';

export async function fetchThread(request, reply) {
  try {
    const thread = await Chat.findById(request.params.threadId);
    if (!thread) return reply.code(404).send({ success: false, message: 'Thread not found' });

    // authorize: only participants or admin may fetch
    const uid = String(request.user?.id);
    if (!thread.participants.map(String).includes(uid) && request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, message: 'Forbidden' });
    }

    return reply.send({ success: true, data: thread });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to fetch thread' });
  }
}

export async function sendMessage(request, reply) {
  try {
    const { threadId } = request.params;
    const { text } = request.body || {};
    if (!text) return reply.code(400).send({ success: false, message: 'text is required' });

    const thread = await Chat.findById(threadId);
    if (!thread) return reply.code(404).send({ success: false, message: 'Thread not found' });

    const senderId = String(request.user?.id);
    if (!thread.participants.map(String).includes(senderId)) return reply.code(403).send({ success: false, message: 'Forbidden' });

    const msg = { senderId, message: text, timestamp: new Date(), seen: false };
    thread.messages.push(msg);
    await thread.save();

    // emit over websocket if available
    try {
      if (request.server && request.server.io) {
        request.server.io.to(threadId).emit('message', { threadId, message: msg });
      } else if (request.server && request.server.socket && request.server.socket.io) {
        // fallback in case plugin registers differently
        request.server.socket.io.to(threadId).emit('message', { threadId, message: msg });
      } else if (request.server && request.server.io === undefined && request.server.fastify && request.server.fastify.io) {
        request.server.fastify.io.to(threadId).emit('message', { threadId, message: msg });
      } else if (request.server && request.server.io === undefined && request.server.emit) {
        // no-op; leave for compatibility
      }
    } catch (e) {
      request.log?.warn?.('socket emit failed', e?.message);
    }

    // Notify other participants (non-blocking)
    try {
      const sender = await User.findById(senderId).select('name');
      const otherParticipantIds = (thread.participants || []).map(String).filter(id => id !== String(senderId));
      const title = `${sender?.name || 'New message'}`;
      const body = text.length > 120 ? text.substring(0, 117) + '...' : text;
      // fetch booking name for context if available
      let bookingName = null;
      try {
        if (thread.bookingId) {
          const b = await Booking.findById(thread.bookingId).select('service').lean();
          bookingName = b?.service || null;
        }
      } catch (e) {
        request.log?.warn?.('failed to lookup booking for chat notify', e?.message || e);
      }
      for (const pid of otherParticipantIds) {
        try {
          // include bookingName and bookingId in data if present for context
          await createNotification(request.server, pid, { type: 'chat', title, body, data: { threadId, bookingId: thread.bookingId, bookingName, senderId } });
        } catch (e) {
          request.log?.warn?.('notify participant failed', e?.message || e);
        }
      }
    } catch (e) {
      request.log?.warn?.('chat notify failed', e?.message || e);
    }

    return reply.code(201).send({ success: true, data: thread.messages[thread.messages.length - 1] });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to send message' });
  }
}

export async function fetchThreadByBooking(request, reply) {
  try {
    const { bookingId } = request.params;
    if (!bookingId) return reply.code(400).send({ success: false, message: 'bookingId required' });

    // find chat by bookingId and populate participants + message senders
    const thread = await Chat.findOne({ bookingId })
      .populate('participants', 'name profileImage role')
      .populate('messages.senderId', 'name profileImage');

    if (!thread) return reply.code(404).send({ success: false, message: 'Thread not found' });

    // authorize: only participants or admin may fetch
    const uid = String(request.user?.id);
    const participantIds = thread.participants.map(p => String(p._id));
    if (!participantIds.includes(uid) && request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, message: 'Forbidden' });
    }

    // normalise participant info: expose profileImageUrl for convenience
    const participants = thread.participants.map(p => ({
      _id: p._id,
      name: p.name,
      role: p.role,
      profileImageUrl: p.profileImage?.url || null,
    }));

    // map message senders to include name + profileImageUrl if populated
    const messages = (thread.messages || []).map(m => ({
      _id: m._id,
      senderId: m.senderId?._id || m.senderId,
      senderName: m.senderId?.name || null,
      senderImageUrl: m.senderId?.profileImage?.url || null,
      message: m.message,
      timestamp: m.timestamp,
      seen: m.seen,
    }));

    return reply.send({ success: true, data: { threadId: thread._id, bookingId: thread.bookingId, participants, messages, isClosed: thread.isClosed } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to fetch thread by bookingId' });
  }
}
