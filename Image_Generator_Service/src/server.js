const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const imageRoutes = require('./routes/imageRoutes');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3009;

// Increase payload size limit
const MAX_PAYLOAD_SIZE = '100mb';

// Middleware
app.use(cors());
app.use(express.json({ 
    limit: MAX_PAYLOAD_SIZE,
    parameterLimit: 100000,
    extended: true 
}));
app.use(express.urlencoded({ 
    limit: MAX_PAYLOAD_SIZE,
    parameterLimit: 100000,
    extended: true 
}));

// Increase timeout
app.use((req, res, next) => {
    res.setTimeout(300000, () => {
        console.log('Request has timed out.');
        res.status(408).send('Request has timed out.');
    });
    next();
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/videogenerator')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/images', imageRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      status: 'error',
      message: 'Request entity too large'
    });
  }
  res.status(500).json({
    status: 'error',
    message: 'Something went wrong!'
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 