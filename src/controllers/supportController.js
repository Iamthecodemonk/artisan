import Chat from '../models/Chat.js';
import { createNotification } from '../utils/notifier.js';

export async function createSupportThread(request, reply) {
  try {
    const userId = request.user?.id;
    if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });
    const { subject, message } = request.body || {};
    if (!message) return reply.code(400).send({ success: false, message: 'message required' });

    const thread = await Chat.create({ participants: [userId], messages: [{ senderId: userId, message }], createdAt: new Date() });

    // notify admins
    try {
      await createNotification(request.server, null, { type: 'support', title: 'New support request', body: subject || 'User opened support thread', data: { threadId: thread._id } });
    } catch (e) {
      request.log?.warn?.('notify admin failed', e?.message || e);
    }

    // emit via socket to admins and user room
    try {
      const io = request.server.io;
      if (io) {
        io.to('admin').emit('support_thread_created', { threadId: String(thread._id), userId });
        io.to(String(userId)).emit('support_thread_created', { threadId: String(thread._id) });
      }
    } catch (e) {
      request.log?.warn?.('socket emit support_thread_created failed', e?.message || e);
    }

    return reply.code(201).send({ success: true, data: thread });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to create support thread' });
  }
}

export async function postSupportMessage(request, reply) {
  try {
    const userId = request.user?.id;
    if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });
    const { threadId } = request.params || {};
    const { message } = request.body || {};
    if (!threadId || !message) return reply.code(400).send({ success: false, message: 'threadId and message required' });

    const thread = await Chat.findById(threadId);
    if (!thread) return reply.code(404).send({ success: false, message: 'Thread not found' });

    // allow participants or any authenticated user (support threads are open to create)
    if (!thread.participants.map(String).includes(String(userId))) {
      // add user to participants when they post
      thread.participants.push(userId);
    }

    const msg = { senderId: userId, message, timestamp: new Date(), seen: false };
    thread.messages.push(msg);
    await thread.save();

    // emit to admins and participants
    try {
      const io = request.server.io;
      if (io) {
        io.to('admin').emit('support_message', { threadId: String(thread._id), message: msg });
        for (const p of thread.participants) {
          io.to(String(p)).emit('support_message', { threadId: String(thread._id), message: msg });
        }
      }
    } catch (e) {
      request.log?.warn?.('socket emit support_message failed', e?.message || e);
    }

    return reply.code(201).send({ success: true, data: msg });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to post support message' });
  }
}

export async function listSupportThreadsForUser(request, reply) {
  try {
    const userId = request.user?.id;
    if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });
    const threads = await Chat.find({ participants: userId }).sort({ createdAt: -1 }).lean();
    return reply.send({ success: true, data: threads });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list support threads' });
  }
}

export async function listAllSupportThreads(request, reply) {
  try {
    // admin-only
    const threads = await Chat.find({}).sort({ createdAt: -1 }).lean();
    return reply.send({ success: true, data: threads });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list support threads' });
  }
}

export async function getSupportThread(request, reply) {
  try {
    const userId = request.user?.id;
    if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });
    const { threadId } = request.params || {};
    if (!threadId) return reply.code(400).send({ success: false, message: 'threadId required' });

    const thread = await Chat.findById(threadId).lean();
    if (!thread) return reply.code(404).send({ success: false, message: 'Thread not found' });

    // allow access if user is a participant or has admin role
    const isParticipant = Array.isArray(thread.participants) && thread.participants.map(String).includes(String(userId));
    const isAdmin = request.user?.role === 'admin';
    if (!isParticipant && !isAdmin) return reply.code(403).send({ success: false, message: 'Forbidden' });

    return reply.send({ success: true, data: thread });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get support thread' });
  }
}
