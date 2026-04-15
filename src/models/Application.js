import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  artisanId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  coverNote: { type: String },
  proposedPrice: { type: Number },
  // Optional line items the artisan can submit (mapped into Quote.items)
  items: [
    {
      name: String,
      qty: { type: Number, default: 1 },
      note: String,
      cost: { type: Number, default: 0 },
    },
  ],
  // Optional uploaded attachments (small metadata)
  attachments: [
    {
      url: String,
      public_id: String,
    },
  ],
  status: { type: String, enum: ['applied','accepted','rejected','withdrawn'], default: 'applied' },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Application', applicationSchema);
