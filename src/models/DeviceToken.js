import mongoose from 'mongoose';

const DeviceTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  token: { type: String, required: true, unique: true, maxlength: 2048 },
  platform: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Remove tokens that have not been updated for 90 days (cleanup stale device tokens)
DeviceTokenSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7776000 });

DeviceTokenSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('DeviceToken', DeviceTokenSchema);
