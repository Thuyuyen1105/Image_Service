require('dotenv').config();
const express = require('express');
const cors = require('cors');
const imageRoutes = require('./src/routes/imageRoutes');
const RabbitMQConsumer = require('./src/rabbitmq');
const WorkerPool = require('./src/workerPool');
const { connectDB, closeDB } = require('./src/database');

const app = express();
const port = process.env.PORT || 3006;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/images', imageRoutes);

// Initialize worker pool
const workerPool = new WorkerPool();
workerPool.initialize();

// Initialize RabbitMQ consumer
const consumer = new RabbitMQConsumer(workerPool);

async function startServer() {
    try {
        // Connect to MongoDB
        await connectDB();
        console.log('Connected to MongoDB');

        // Connect to RabbitMQ
        const connected = await consumer.connect();
        if (!connected) {
            console.error('Failed to connect to RabbitMQ');
            process.exit(1);
        }

        // Start consuming messages
        await consumer.startConsuming();

        // Start Express server
        app.listen(port, () => {
            console.log(`Server is running on port ${port}`);
        });
    } catch (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Closing connections...');
    await consumer.close();
    await closeDB();
    workerPool.terminate();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received. Closing connections...');
    await consumer.close();
    await closeDB();
    workerPool.terminate();
    process.exit(0);
});

startServer(); 