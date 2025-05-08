const { parentPort } = require('worker_threads');
const path = require('path');
const { connectDB } = require('./database');
const imageService = require(path.join(__dirname, 'services', 'imageService'));
const Job = require('./models/Job');
const mongoose = require('mongoose');

async function generateImage(jobData) {
    try {
        await connectDB();

        const { 
            jobId,
            userId,
            prompt,
            scriptId,
            splitScriptId,
            style = 'realistic',
            resolution = '1024x1024',
            metadata = {}
        } = jobData;

        // Validate tất cả các trường cần thiết cho job
        if (!jobId || !userId || !prompt || !scriptId || !splitScriptId) {
            throw new Error('Missing required fields: jobId, userId, prompt, scriptId, splitScriptId');
        }

        // Tìm hoặc tạo job mới
        let job = await Job.findOne({ jobId });
        if (!job) {
            job = new Job({
                jobId,
                scriptId,
                userId,
                totalImages: metadata.totalImage || 1,
                completedImages: 0,
                status: 'processing',
                imageIds: []
            });
            await job.save();
        }

        // Chỉ gửi các trường cần thiết cho imageService
        const result = await imageService.generateImage({
            prompt,
            style,
            resolution,
            scriptId,
            splitScriptId
        });

        console.log('Image generation result:', {
            jobId,
            imageStatus: result.status,
            imageId: result.data.imageId,
            url: result.data.url
        });

        // Chỉ cộng completedImages khi tạo ảnh thành công
        if (result.status === 'generated') {
            console.log('Updating job completedImages:', {
                jobId,
                beforeCompleted: job.completedImages,
                afterCompleted: job.completedImages + 1,
                totalImages: job.totalImages
            });

            await Job.updateOne({ jobId }, {
                $inc: { completedImages: 1 },
                $push: { imageIds: result.data.imageId },
                $set: { updatedAt: new Date() }
            });

            // Kiểm tra và cập nhật status
            const updatedJob = await Job.findOne({ jobId });
            console.log('Job status check:', {
                jobId,
                completedImages: updatedJob.completedImages,
                totalImages: updatedJob.totalImages,
                currentStatus: updatedJob.status
            });

            if (updatedJob.completedImages >= updatedJob.totalImages) {
                console.log('Updating job status to completed:', {
                    jobId,
                    completedImages: updatedJob.completedImages,
                    totalImages: updatedJob.totalImages
                });
                await Job.updateOne(
                    { jobId },
                    { $set: { status: 'completed' } }
                );
                
                // Emit socket event for job completion
                parentPort.postMessage({
                    type: 'jobCompleted',
                    data: {
                        jobId,
                        userId,
                        status: 'completed',
                        completedImages: updatedJob.completedImages,
                        totalImages: updatedJob.totalImages,
                        images: updatedJob.imageIds
                    }
                });
            }
        } else {
            console.log('Not updating completedImages - image not generated:', {
                jobId,
                imageStatus: result.status,
                currentCompleted: job.completedImages
            });
        }

        // Gửi kết quả về main thread
        parentPort.postMessage({
            type: 'imageGenerated',
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
                // Chỉ set status failed nếu chưa có ảnh nào được tạo thành công
                if (job.imageIds.length === 0) {
                    job.status = 'failed';
                    job.error = error.message;
                    await job.save();
                    
                    // Emit socket event for job failure
                    parentPort.postMessage({
                        type: 'jobFailed',
                        data: {
                            jobId: jobData.jobId,
                            userId: jobData.userId,
                            error: error.message
                        }
                    });
                }
            }
        } catch (dbError) {
            console.error('Error updating job status:', dbError);
        }

        parentPort.postMessage({
            type: 'error',
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