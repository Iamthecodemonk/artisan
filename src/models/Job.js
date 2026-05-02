import mongoose from 'mongoose';
import crypto from 'crypto';

const jobSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  title: { type: String, required: true },
  description: { type: String },
  trade: { type: [String], default: [] },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobCategory', index: true },
  location: { type: String },
  coordinates: { type: [Number], index: '2dsphere' }, // [lon, lat]
  experienceLevel: { type: String, enum: ['entry','mid','senior'], default: 'entry' },
  attachments: { type: [{ url: String, public_id: String }], default: [] },
  budget: { type: Number },
  schedule: Date,
  status: { type: String, enum: ['open','filled','closed'], default: 'open' },
  publicId: { type: String, unique: true, index: true },
  createdAt: { type: Date, default: Date.now },
});

// generate a public id like 'rh+' + 8 alnum chars
function makePublicId() {
  // use base64 then strip non-alnum to get compact chars
  const s = crypto.randomBytes(8).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0,8);
  return `rh+${s}`;
}

// Ensure a publicId is generated and unique on create
jobSchema.pre('save', async function(next) {
  try {
    if (!this.isNew) return next();
    if (!this.publicId) this.publicId = makePublicId();
    // try a few times if collision
    let attempts = 0;
    while (attempts < 5) {
      const exists = await this.constructor.findOne({ publicId: this.publicId }).lean();
      if (!exists) return next();
      this.publicId = makePublicId();
      attempts++;
    }
    return next(new Error('Failed to generate unique publicId for Job'));
  } catch (e) {
    return next(e);
  }
});

// Static helper to find by _id or publicId
jobSchema.statics.findByIdOrPublic = function(idOrPublic) {
  if (!idOrPublic) return this.findOne({ _id: null });
  if (mongoose.Types.ObjectId.isValid(String(idOrPublic))) {
    return this.findById(idOrPublic);
  }
  return this.findOne({ publicId: String(idOrPublic) });
};

export default mongoose.model('Job', jobSchema);
