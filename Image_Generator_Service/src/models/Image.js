const mongoose = require('mongoose');
const { Schema } = mongoose;

const imageSchema = new Schema({
  splitScriptId: {
    type: Schema.Types.ObjectId,
    ref: 'SplitScript',
    required: true
  },
  scriptId: {
    type: Schema.Types.ObjectId, // duplicated for querying convenience
    required: true
  },
  prompt: {
    type: String,
    required: true
  },
  style: {
    type: String,
    enum: ['realistic', 'cartoon', 'anime', 'watercolor', 'oil painting'], // mở rộng nếu cần
    default: 'realistic'
  },
  resolution: {
    type: String,
    default: '1024x1024'
  },
  url: {
    type: String
  },
  status: {
    type: String,
    enum: ['processing', 'generated', 'failed'],
    default: 'processing'
  },
  error: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Image', imageSchema);
