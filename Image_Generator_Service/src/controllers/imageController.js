const imageService = require('../services/imageService');
const Job = require('../models/Job');
const WorkerPool = require('../workerPool');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Initialize worker pool
const workerPool = new WorkerPool();
workerPool.initialize();

// Initialize socket.io
let io;
const initializeSocket = (socketIO) => {
    io = socketIO;
    workerPool.setSocket(io);

    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });
};

const generateImage = async (req, res) => {
    try {
        const { 
            jobId,
            userId,
            prompt,
            style = 'anime',
            resolution = '1024x1024',
            scriptId,
            splitScriptId,
            order,
            metadata
        } = req.body;

        if (!prompt || !scriptId || !jobId || !userId) {
            return res.status(400).json({
                status: 'error',
                message: 'Prompt, scriptId, jobId, and userId are required'
            });
        }

        // Process job through worker pool
        const result = await workerPool.processJob({
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

        res.json(result);
    } catch (error) {
        console.error('Error in generateImage controller:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to generate image'
        });
    }
};

const checkImageStatus = async (req, res) => {
    try {
        const { imageId } = req.params;
        if (!imageId) {
            return res.status(400).json({ status: 'error', message: 'Image ID is required' });
        }

        const result = await imageService.checkImageStatus(imageId);
        res.json(result);
    } catch (error) {
        console.error('Error in checkImageStatus controller:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to check image status'
        });
    }
};

const updateEditedImage = async (req, res) => {
    try {
        const { imageId } = req.params;
        const { imageBase64 } = req.body;

        if (!imageId) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Image ID is required' 
            });
        }

        if (!imageBase64) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'No image data provided' 
            });
        }

        // Validate base64 format
        if (!imageBase64.startsWith('data:image/')) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Invalid image format. Must be a base64 data URL' 
            });
        }

        // Extract the base64 data
        const base64Data = imageBase64.split(',')[1];
        if (!base64Data) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Invalid base64 data format' 
            });
        }

        // Convert base64 to buffer
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Create temporary file
        const tempFilePath = path.join(os.tmpdir(), `edited-image-${Date.now()}.png`);
        fs.writeFileSync(tempFilePath, imageBuffer);

        try {
            const result = await imageService.updateEditedImage(imageId, tempFilePath);
            res.json(result);
        } finally {
            // Clean up temp file
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        }
    } catch (error) {
        console.error('Error in updateEditedImage controller:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update edited image'
        });
    }
};

const regenerateImage = async (req, res) => {
    try {
        const { imageId } = req.params;
        if (!imageId) {
            return res.status(400).json({ status: 'error', message: 'Image ID is required' });
        }

        const result = await imageService.regenerateImage(imageId);
        res.json(result);
    } catch (error) {
        console.error('Error in regenerateImage controller:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to regenerate image'
        });
    }
};

const viewImage = async (req, res) => {
    try {
        const { imageId } = req.params;

        if (!imageId) {
            return res.status(400).json({ status: 'error', message: 'Image ID is required' });
        }

        const imageData = await imageService.getImageById(imageId);

        if (!imageData) {
            return res.status(404).json({ status: 'error', message: 'Image not found' });
        }

        res.json({
            status: 'success',
            data: imageData,
        });
    } catch (error) {
        console.error('Error in viewImage controller:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to retrieve image',
        });
    }
};

const viewImageByScriptId = async (req, res) => {
    try {
        const { scriptId } = req.params;

        if (!scriptId) {
            return res.status(400).json({ status: 'error', message: 'Script ID is required' });
        }

        // Lấy danh sách ảnh từ service
        const images = await imageService.getImagesByScriptId(scriptId);

        if (!images || images.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No images found for the given Script ID' });
        }

        // Trả về danh sách ảnh
        res.json({
            status: 'success',
            data: images,
        });
    } catch (error) {
        console.error('Error in viewImageByScriptId controller:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to retrieve images by Script ID',
        });
    }
};

const viewImageBySplitScriptId = async (req, res) => {
    try {
        const { splitScriptId } = req.params;

        if (!splitScriptId) {
            return res.status(400).json({ status: 'error', message: 'Split Script ID is required' });
        }

        // Lấy danh sách ảnh từ service
        const images = await imageService.getImagesBySplitScriptId(splitScriptId);

        if (!images || images.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No images found for the given Split Script ID' });
        }

        // Trả về danh sách ảnh
        res.json({
            status: 'success',
            data: images,
        });
    } catch (error) {
        console.error('Error in viewImageBySplitScriptId controller:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to retrieve images by Split Script ID',
        });
    }
};

// Check job status
const checkJobStatus = async (req, res) => {
    try {
        const { jobId } = req.params;
        const result = await imageService.checkJobStatus(jobId);
        res.json(result);
    } catch (error) {
        console.error('Error in checkJobStatus controller:', error);
        res.status(500).json({
            status: 'failed',
            error: error.message
        });
    }
};

module.exports = {
    generateImage,
    checkImageStatus,
    updateEditedImage,
    regenerateImage,
    viewImage,
    viewImageByScriptId,
    viewImageBySplitScriptId,
    checkJobStatus,
    initializeSocket
};
