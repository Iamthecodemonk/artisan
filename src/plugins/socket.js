import fp from 'fastify-plugin';
import Chat from '../models/Chat.js';
import { Server as IOServer } from 'socket.io';

export default fp(async function socketPlugin(fastify, opts) {
  // Create a Socket.IO server attached to the Fastify underlying http server
  // Ensure fastify-jwt is registered before this plugin so we can verify tokens
  fastify.log?.info?.('Initializing Socket.IO plugin...');
  
  const io = new IOServer(fastify.server, { 
    cors: { 
      origin: '*',
      methods: ['GET', 'POST']
    },
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    allowEIO3: true
  });
  // attach to fastify instance for other code to use
  fastify.decorate('io', io);
  fastify.log?.info?.('Socket.IO server initialized and attached to fastify.io');

  io.on('connection', async (socket) => {
    fastify.log?.info?.({ socketId: socket.id }, 'New socket connection attempt');
    try {
      const token = socket.handshake?.auth?.token;
      if (!token) {
        fastify.log?.warn?.({ socketId: socket.id }, 'Socket connection rejected: no token provided');
        socket.disconnect(true);
        return;
      }

      let decoded;
      try {
        decoded = await fastify.jwt.verify(token);
      } catch (err) {
        fastify.log?.warn?.({ socketId: socket.id, error: err.message }, 'Socket connection rejected: JWT verification failed');
        socket.disconnect(true);
        return;
      }

      const userId = String(decoded?.id || decoded?.userId || decoded?._id);
      socket.data.userId = userId;
      socket.join(userId);
      // If user is admin, also join the admin room so admin sockets receive support notifications
      try {
        const role = decoded?.role || decoded?.roles || null;
        if (role === 'admin' || (Array.isArray(role) && role.includes('admin'))) {
          socket.join('admin');
          fastify.log?.info?.({ socketId: socket.id, userId }, 'Admin socket joined admin room');
        }
      } catch (e) {
        fastify.log?.warn?.('failed to join admin room', e?.message || e);
      }
      fastify.log?.info?.({ socketId: socket.id, userId }, 'Socket connection authenticated successfully');

      const isParticipant = (thread, uid) => (thread?.participants || []).map(String).includes(String(uid));

      socket.on('join', async (payload, cb) => {
        const { threadId } = payload || {};
        if (!threadId) return cb?.({ success: false, message: 'threadId required' });
        const thread = await Chat.findById(threadId);
        if (!thread) return cb?.({ success: false, message: 'thread not found' });
        if (!isParticipant(thread, userId)) return cb?.({ success: false, message: 'not a participant' });
        socket.join(threadId);
        return cb?.({ success: true });
      });

      socket.on('leave', (payload, cb) => {
        const { threadId } = payload || {};
        if (!threadId) return cb?.({ success: false });
        socket.leave(threadId);
        return cb?.({ success: true });
      });

      socket.on('message', async (payload, cb) => {
        const { threadId, text, meta } = payload || {};
        if (!threadId || !text) return cb?.({ success: false, message: 'threadId and text required' });
        const thread = await Chat.findById(threadId);
        if (!thread) return cb?.({ success: false, message: 'thread not found' });
        if (!isParticipant(thread, userId)) return cb?.({ success: false, message: 'not a participant' });

        const msg = { senderId: userId, message: text, timestamp: new Date(), seen: false };
        if (meta) msg.meta = meta;
        thread.messages.push(msg);
        await thread.save();

        io.to(threadId).emit('message', { threadId, message: msg });
        for (const p of thread.participants) {
          io.to(String(p)).emit('thread_message', { threadId, message: msg });
        }

        return cb?.({ success: true, data: msg });
      });

      socket.on('typing', (payload) => {
        const { threadId, typing } = payload || {};
        if (!threadId) return;
        io.to(threadId).emit('typing', { threadId, userId, typing });
      });

      socket.on('read', async (payload, cb) => {
        const { threadId, messageIds } = payload || {};
        if (!threadId || !Array.isArray(messageIds)) return cb?.({ success: false });
        const thread = await Chat.findById(threadId);
        if (!thread) return cb?.({ success: false });
        thread.messages.forEach((m) => { if (messageIds.includes(String(m._id))) m.seen = true; });
        await thread.save();
        io.to(threadId).emit('read', { threadId, messageIds, userId });
        return cb?.({ success: true });
      });

      socket.on('disconnect', () => {
        fastify.log?.info?.({ socketId: socket.id, userId }, 'Socket disconnected');
        socket.leave(userId);
      });

    } catch (err) {
      console.log(err);
      fastify.log?.error?.({ socketId: socket.id, error: err.message, stack: err.stack }, 'Socket connection error - disconnecting');
      try { socket.disconnect(true); } catch (e) {}
    }
  });
});