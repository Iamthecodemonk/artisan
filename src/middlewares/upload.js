// Lightweight upload middleware placeholder for fastify-multipart
// In routes use this as a preHandler to ensure multipart parsing is available.
export default async function upload(request, reply) {
  // If not multipart, skip
  if (!request.isMultipart) return;

  // Collect files into request.uploadedFiles (simple approach)
  request.uploadedFiles = [];
  // Ensure request.body exists so form fields are available to handlers
  request.body = request.body || {};

  try {
    // Support multiple multipart APIs across @fastify/multipart versions
    if (typeof request.multipart === 'function') {
      // older callback-style API
      await request.multipart(async (field, file, filename, encoding, mimetype) => {
        const chunks = [];
        for await (const chunk of file) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        request.uploadedFiles.push({ field, filename, encoding, mimetype, buffer });
      });
    } else if (typeof request.parts === 'function') {
      // async iterator API
      for await (const part of request.parts()) {
        if (part.file) {
          const chunks = [];
          for await (const chunk of part.file) chunks.push(chunk);
          const buffer = Buffer.concat(chunks);
          request.uploadedFiles.push({ field: part.fieldname || part.field, filename: part.filename, encoding: part.encoding, mimetype: part.mimetype, buffer });
        } else {
          // non-file field (text) — store into request.body so handlers can read it
          try {
            const name = part.fieldname || part.field;
            const value = part.value;
            if (name) {
              // if multiple values exist for same field, convert to array
              if (Object.prototype.hasOwnProperty.call(request.body, name)) {
                const cur = request.body[name];
                if (Array.isArray(cur)) request.body[name].push(value);
                else request.body[name] = [cur, value];
              } else {
                request.body[name] = value;
              }
            }
          } catch (e) {
            // ignore non-fatal field parsing errors
          }
        }
      }
    } else if (typeof request.file === 'function') {
      // single-file helper
      const f = await request.file();
      if (f && f.file) {
        const chunks = [];
        for await (const chunk of f.file) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        request.uploadedFiles.push({ field: f.fieldname || f.field, filename: f.filename, encoding: f.encoding, mimetype: f.mimetype, buffer });
      }
    } else {
      // last resort: no supported multipart API found
      throw new Error('multipart parsing not available on request (missing plugin?)');
    }
  } catch (err) {
    // ignore or forward - preHandler should throw to stop request
    request.log?.error?.(err);
    throw err;
  }
}
