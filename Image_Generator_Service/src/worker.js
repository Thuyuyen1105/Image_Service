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
            resolution = '1024x1024'
        } = jobData;

        // Find existing job
        const job = await Job.findOne({ jobId });
        if (!job) {
            throw new Error('Job not found');
        }

        // Generate image
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

        // Update job only if image was generated successfully
        if (result.status === 'generated') {
            const updatedJob = await Job.findOneAndUpdate(
                { jobId },
                {
                    $inc: { completedImages: 1 },
                    $push: { imageIds: result.data.imageId },
                    $set: { updatedAt: new Date() }
                },
                { new: true }
            );

            if (!updatedJob) {
                throw new Error('Failed to update job after image generation');
            }

            console.log('Job status check:', {
                jobId,
                completedImages: updatedJob.completedImages,
                totalImages: updatedJob.totalImages,
                currentStatus: updatedJob.status
            });

            // Check if job is completed
            if (updatedJob.completedImages >= updatedJob.totalImages) {
                const completedJob = await Job.findOneAndUpdate(
                    { jobId },
                    { $set: { status: 'completed' } },
                    { new: true }
                );

                if (completedJob) {
                    parentPort.postMessage({
                        type: 'jobCompleted',
                        data: {
                            jobId,
                            userId,
                            status: 'completed',
                            completedImages: completedJob.completedImages,
                            totalImages: completedJob.totalImages,
                            images: completedJob.imageIds || []
                        }
                    });
                }
            }
        }

        // Send result back to main thread
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
        
        try {
            // Update job status on error
            const job = await Job.findOne({ jobId: jobData.jobId });
            if (job) {
                const imageIds = job.imageIds || [];
                if (imageIds.length === 0) {
                    await Job.findOneAndUpdate(
                        { jobId: jobData.jobId },
                        {
                            $set: {
                                status: 'failed',
                                error: error.message,
                                updatedAt: new Date()
                            }
                        }
                    );
                    
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

// Listen for messages from main thread
parentPort.on('message', (jobData) => {
    generateImage(jobData);
});