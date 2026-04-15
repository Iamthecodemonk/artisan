import mongoose from 'mongoose';

const artisanServiceSchema = new mongoose.Schema({
  // Store the artisan as a reference to the User document (artisan.userId)
  // Previously this field stored the Artisan._id; we now normalize to User._id.
  artisanId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobCategory', required: true, index: true },
  services: [
    {
      subCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobSubCategory', required: true },
      price: { type: Number, required: true },
      currency: { type: String, default: 'NGN' },
      notes: { type: String },
      isActive: { type: Boolean, default: true }
    }
  ],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

artisanServiceSchema.index({ artisanId: 1, categoryId: 1 }, { unique: true });

artisanServiceSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('ArtisanService', artisanServiceSchema);
