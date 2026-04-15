import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema({
  url: { type: String },
  filename: { type: String },
  mimeType: { type: String },
});

const artisanReplySchema = new mongoose.Schema({
  // `quote` used for fixed-price responses
  quote: { type: mongoose.Schema.Types.Mixed },
  // quoteType: 'fixed' or 'range'
  quoteType: { type: String, enum: ['fixed', 'range'], default: 'fixed' },
  // for range quotes
  minQuote: { type: Number },
  maxQuote: { type: Number },
  // generated price options for range (5 options)
  options: [{ type: Number }],
  message: { type: String },
  responseAt: { type: Date },
  artisanId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const specialServiceRequestSchema = new mongoose.Schema({
  artisanId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  artisanName: { type: String },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  clientName: { type: String },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobCategory' },
  categoryName: { type: String },
  title: { type: String },
  description: { type: String, required: true },
  location: { type: String },
  date: { type: Date },
  time: { type: String },
  urgency: { type: String, enum: ['Normal', 'High', 'Low'], default: 'Normal' },
  budget: { type: mongoose.Schema.Types.Mixed },
  scheduledDate: { type: Date },
  attachments: [attachmentSchema],
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', index: true },
  status: { type: String, enum: ['pending','responded','accepted','confirmed','in_progress','completed','cancelled','rejected','declined'], default: 'pending', index: true },
  artisanReply: artisanReplySchema,
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
});

specialServiceRequestSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

specialServiceRequestSchema.index({ artisanId: 1, clientId: 1, status: 1 });

export default mongoose.model('SpecialServiceRequest', specialServiceRequestSchema);
