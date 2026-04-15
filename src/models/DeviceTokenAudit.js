import mongoose from 'mongoose';

const DeviceTokenAuditSchema = new mongoose.Schema({
  token: { type: String, required: true, index: true },
  oldUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  newUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reason: { type: String },
  createdAt: { type: Date, default: Date.now, index: true }
});

export default mongoose.model('DeviceTokenAudit', DeviceTokenAuditSchema);
