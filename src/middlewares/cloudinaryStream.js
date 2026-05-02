import cloudinary from '../utils/cloudinary.js';

export default async function cloudinaryStream(request, reply) {
  // Middleware to stream multipart parts directly to Cloudinary and populate request.uploadedFiles
  const contentType = String(request.headers?.['content-type'] || '').toLowerCase();
  const isMultipartRequest =
    contentType.includes('multipart/form-data') &&
    typeof request.parts === 'function';

  if (!isMultipartRequest) return;

  request.uploadedFiles = request.uploadedFiles || [];
  request.uploadErrors = request.uploadErrors || [];

  try {
    for await (const part of request.parts()) {
      const fieldName = part.field || part.fieldname || part.fieldName || part.name || null;
      // collect non-file fields into request.body so controllers can access form data
      if (!part.file) {
        try {
          request.body = request.body || {};
          // value might be a property or a function depending on versions
          let value;
          if (typeof part.value === 'function') {
            try {
              value = await part.value();
            } catch (vErr) {
              value = undefined;
            }
          } else {
            value = part.value;
          }

          if (typeof fieldName === 'string') {
            if (request.body[fieldName] !== undefined) {
              if (!Array.isArray(request.body[fieldName])) {
                request.body[fieldName] = [request.body[fieldName]];
              }
              request.body[fieldName].push(value);
            } else {
              request.body[fieldName] = value;
            }
          }
        } catch (e) {
          request.log?.warn?.({ reqId: request.id, err: e?.message || e }, 'failed to collect multipart field');
        }
        continue;
      }
      try {
        const res = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream({ folder: 'uploads', resource_type: 'auto' }, (err, result) => {
            if (err) return reject(err);
            resolve(result);
          });
          part.file.pipe(uploadStream);
        });

        request.uploadedFiles.push({
          field: fieldName,
          filename: part.filename || null,
          mimetype: part.mimetype || null,
          url: res.secure_url || res.url,
          public_id: res.public_id,
        });
      } catch (err) {
        const errObj = { field: fieldName, message: err?.message || String(err), stack: err?.stack || null };
        request.log?.warn({ reqId: request.id, ...errObj }, 'cloudinaryStream upload failed');
        request.uploadErrors.push(errObj);
      }
    }
  } catch (err) {
    const errObj = { message: err?.message || String(err), stack: err?.stack || null };
    request.log?.error({ reqId: request.id, ...errObj }, 'cloudinaryStream failed');
    request.uploadErrors.push(errObj);
    // do not throw here — let controller decide how to handle uploadErrors
  }
}
