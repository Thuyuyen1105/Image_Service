const { parentPort } = require('worker_threads');
const path = require('path');
const { connectDB } = require('./database');
const imageService = require(path.join(__dirname, 'services', 'imageService'));
const Job = require('./models/Job');

async function generateImage(jobData) {
    try {
        // Connect to MongoDB
        await connectDB();

        // Validate required fields
        const { 
            jobId,
            userId,
            prompt,
            scriptId,
            splitScriptId,
            order,
            style = 'realistic',
            resolution = '1024x1024',
            metadata = {}
        } = jobData;

        // Kiểm tra các trường bắt buộc
        if (!jobId || !userId || !prompt || !scriptId || !splitScriptId) {
            throw new Error('Missing required fields: jobId, userId, prompt, scriptId, splitScriptId');
        }

        // Tìm hoặc tạo job mới
        let job = await Job.findOne({ jobId });
        if (!job) {
            // Tạo job mới nếu chưa tồn tại
            job = new Job({
                jobId,
                scriptId,
                userId,
                totalImages: metadata.totalImages || 1,
                completedImages: 0,
                status: 'processing'
            });
            await job.save();
        }

        // Tạo ảnh
        const result = await imageService.generateImage({
            jobId,
            userId,
            prompt,
            style,
            resolution,
            scriptId,
            splitScriptId,
            order,
            metadata
        });

        if (image.status === 'generated') {
            await Job.updateOne({ jobId }, {
                $inc: { completedImages: 1 },
                $set: { updatedAt: new Date() }
              });
        }
        
        if (job.completedImages >= job.totalImages) {
            job.status = 'completed';
        }
        await job.save();

        // Gửi kết quả về main thread
        parentPort.postMessage({
            success: true,
            data: {
                ...result.data,
                jobStatus: {
                    completed: job.completedImages,
                    total: job.totalImages,
                    isCompleted: job.status === 'completed'
                }
            }
        });

    } catch (error) {
        console.error('Error in worker:', error);
        
        // Cập nhật trạng thái job nếu có lỗi
        try {
            const job = await Job.findOne({ jobId: jobData.jobId });
            if (job) {
                job.status = 'failed';
                job.error = error.message;
                await job.save();
            }
        } catch (dbError) {
            console.error('Error updating job status:', dbError);
        }

        // Gửi thông báo lỗi với URL mặc định
        parentPort.postMessage({
            success: false,
            error: error.message,
            jobId: jobData.jobId,
            userId: jobData.userId,
            defaultImageUrl: 'https://res.cloudinary.com/dxpz4afdv/image/upload/v1746636099/video-generator/rwsbeeqlc3zbrq4jcl2s.jpg'
        });
    }
}

// Lắng nghe message từ main thread
parentPort.on('message', (jobData) => {
    generateImage(jobData);
});