const amqp = require('amqplib');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

class RabbitMQConsumer {
    constructor(workerPool) {
        this.connection = null;
        this.channel = null;
        this.workerPool = workerPool;
        this.queue = 'image_generate_queue';
    }

    async connect() {
        try {
            this.connection = await amqp.connect(process.env.RABBITMQ_URL);
            this.channel = await this.connection.createChannel();
            
            // Create queue if it doesn't exist
            await this.channel.assertQueue(this.queue, {
                durable: true
            });

            // Set prefetch count to control how many messages each worker can handle
            await this.channel.prefetch(this.workerPool.size);

            console.log('Connected to RabbitMQ');
            return true;
        } catch (error) {
            console.error('Error connecting to RabbitMQ:', error);
            return false;
        }
    }

    async startConsuming() {
        console.log('Starting to consume messages from queue:', this.queue);
        
        this.channel.consume(this.queue, async (msg) => {
            if (msg !== null) {
                try {
                    const jobData = JSON.parse(msg.content.toString());
                    console.log(`Processing job ${jobData.jobId}`);

                    // Process image generation using worker pool
                    const result = await this.workerPool.processJob(jobData);

                    if (result.success) {
                        console.log(`Image generated successfully for job ${jobData.jobId}`);
                        console.log('Image URL:', result.data.url);

                        // Acknowledge the message
                        this.channel.ack(msg);
                    } else {
                        console.error(`Error processing job ${jobData.jobId}:`, result.error);
                        // Reject the message and requeue
                        this.channel.nack(msg, false, true);
                    }
                } catch (error) {
                    console.error('Error processing message:', error);
                    // Reject the message and requeue
                    this.channel.nack(msg, false, true);
                }
            }
        });

        console.log('Consumer started successfully');
    }

    async close() {
        try {
            if (this.channel) {
                await this.channel.close();
            }
            if (this.connection) {
                await this.connection.close();
            }
            console.log('RabbitMQ connection closed');
        } catch (error) {
            console.error('Error closing RabbitMQ connection:', error);
        }
    }
}

module.exports = RabbitMQConsumer; 