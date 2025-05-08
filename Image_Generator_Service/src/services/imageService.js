const { HfInference } = require('@huggingface/inference');
const cloudinary = require('cloudinary').v2;
const Image = require('../models/Image');
const Job = require('../models/Job');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const os = require('os');
const mongoose = require('mongoose');

dotenv.config();

// Validate environment variables
if (!process.env.HUGGINGFACE_API_KEY) {
    throw new Error('HUGGINGFACE_API_KEY is required');
}

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary credentials are required');
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to handle retries
async function withRetry(operation, maxRetries = MAX_RETRIES) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            console.error(`Attempt ${i + 1} failed:`, error.message);
            if (i < maxRetries - 1) {
                await delay(RETRY_DELAY * (i + 1)); // Exponential backoff
            }
        }
    }
    throw lastError;
}

const generateImage = async (params) => {
    const {
        prompt,
        style = 'anime',
        resolution = '1024x1024',
        scriptId,
        splitScriptId
    } = params;

    // Chỉ validate các trường cần thiết
    if (!prompt || !scriptId || !splitScriptId) {
        throw new Error('Prompt, scriptId, and splitScriptId are required');
    }

    let image = null;
    let tempFilePath = null;

    try {
        // Tạo enhanced prompt với style
        const styleDescription = {
            realistic: 'in a photorealistic style with high detail and natural lighting',
            cartoon: 'in a vibrant cartoon style with bold colors and clean lines',
            anime: 'in an anime art style with expressive features and dynamic composition',
            watercolor: 'in a soft watercolor painting style with flowing colors and gentle brushstrokes',
            'oil painting': 'in an oil painting style with rich textures and classical composition'
        }[style.toLowerCase()] || `in a ${style} style`;

        const enhancedPrompt = `${prompt}, ${styleDescription}, high quality, detailed, professional`;

        // Generate image using Stable Diffusion with retry logic
        const response = await withRetry(async () => {
            try {
                return await hf.textToImage({
                    model: 'stabilityai/stable-diffusion-xl-base-1.0',
                    inputs: enhancedPrompt,
                    parameters: {
                        negative_prompt: 'low quality, blurry, distorted',
                        num_inference_steps: 50,
                        guidance_scale: 7.5,
                        width: parseInt(resolution.split('x')[0]),
                        height: parseInt(resolution.split('x')[1])
                    }
                });
            } catch (error) {
                console.error('HuggingFace API error:', error);
                throw new Error(`HuggingFace API error: ${error.message}`);
            }
        });

        // Process the response with timeout
        const buffer = await Promise.race([
            response.arrayBuffer(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout while processing image data')), 30000)
            )
        ]);

        tempFilePath = path.join(os.tmpdir(), `image-${Date.now()}.png`);
        fs.writeFileSync(tempFilePath, Buffer.from(buffer));

        // Upload to Cloudinary with retry logic
        const uploadResult = await withRetry(async () => {
            try {
                return await cloudinary.uploader.upload(tempFilePath, {
                    folder: 'video-generator',
                    resource_type: 'image',
                    transformation: [{ width: 1024, height: 1024, crop: 'fill' }]
                });
            } catch (error) {
                console.error('Cloudinary upload error:', error);
                throw new Error(`Cloudinary upload error: ${error.message}`);
            }
        });

        // Tạo image record với đúng schema
        image = new Image({
            splitScriptId,    // required
            scriptId,         // required
            prompt,           // required
            style,            // enum: ['realistic', 'cartoon', 'anime', 'watercolor', 'oil painting']
            resolution,       // default: '1024x1024'
            url: uploadResult.secure_url,
            status: 'generated',
            createdAt: new Date(),
            updatedAt: new Date()
        });
        await image.save();

        // Clean up temp file
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        return {
            status: 'generated',
            data: {
                imageId: image._id,
                url: image.url,
                status: image.status,
                prompt: image.prompt,
                style: image.style,
                resolution: image.resolution,
                scriptId: image.scriptId,
                splitScriptId: image.splitScriptId,
                createdAt: image.createdAt,
                updatedAt: image.updatedAt
            }
        };
    } catch (error) {
        console.error('Error in generateImage:', error);
        
        // Clean up temp file if exists
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        // Tạo image record với default URL và đúng schema
        const defaultImageUrl = 'https://res.cloudinary.com/dxpz4afdv/image/upload/v1746636099/video-generator/rwsbeeqlc3zbrq4jcl2s.jpg';
        
        image = new Image({
            splitScriptId,    // required
            scriptId,         // required
            prompt,           // required
            style,            // enum: ['realistic', 'cartoon', 'anime', 'watercolor', 'oil painting']
            resolution,       // default: '1024x1024'
            url: defaultImageUrl,
            status: 'generated',
            error: error.message,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        await image.save();

        return {
            status: 'generated',
            error: error.message,
            data: {
                imageId: image._id,
                url: image.url,
                status: image.status,
                prompt: image.prompt,
                style: image.style,
                resolution: image.resolution,
                scriptId: image.scriptId,
                splitScriptId: image.splitScriptId,
                error: image.error,
                createdAt: image.createdAt,
                updatedAt: image.updatedAt
            }
        };
    }
};

// Check image generation status
const checkImageStatus = async (imageId) => {
  const image = await Image.findById(imageId);
  if (!image) {
    throw new Error('Image not found');
  }

  return {
    status: 'success',
    data: {
      imageId: image._id,
      status: image.status,
      url: image.url,
      prompt: image.prompt,
      style: image.style,
      resolution: image.resolution,
      scriptId: image.scriptId,
      error: image.error
    }
  };
};

// Update manually edited image
const updateEditedImage = async (imageId, localFilePath) => {
  const image = await Image.findById(imageId);
  if (!image) {
    throw new Error('Image not found');
  }

  if (!image.url) {
    throw new Error('Original image does not have a Cloudinary URL');
  }

  const publicId = image.url
    .split('/')
    .slice(-2)
    .join('/')
    .split('.')[0];

  const uploadResult = await cloudinary.uploader.upload(localFilePath, {
    public_id: publicId,
    overwrite: true,
    transformation: [{ width: 1024, height: 1024, crop: 'fill' }]
  });

  image.updatedAt = new Date();
  await image.save();

  if (fs.existsSync(localFilePath)) {
    fs.unlinkSync(localFilePath);
  }

  return {
    status: 'success',
    data: {
      imageId: image._id,
      url: uploadResult.secure_url,
      status: image.status,
      prompt: image.prompt,
      style: image.style,
      resolution: image.resolution,
      scriptId: image.scriptId,
    }
  };
};

const regenerateImage = async (imageId) => {
  const image = await Image.findById(imageId);
  if (!image) {
    throw new Error('Image not found');
  }

  if (!image.prompt || !image.scriptId) {
    throw new Error('Missing prompt or scriptId for image');
  }

  let tempFilePath = null;

  try {
    console.log('Generating new image with prompt:', image.prompt);

    // Tạo lại ảnh mới
    const enhancedPrompt = `${image.prompt}, high quality, detailed, professional`;

    // Generate a random seed value to ensure different results each time
    const seed = Math.floor(Math.random() * 1000000);

    console.log('Generated seed:', seed);

    const response = await hf.textToImage({
      model: 'stabilityai/stable-diffusion-xl-base-1.0',
      inputs: enhancedPrompt,
      parameters: {
        negative_prompt: 'low quality, blurry, distorted',
        num_inference_steps: 50,
        guidance_scale: 7.5,
        seed: seed,
      }
    });

    console.log('Received response from Hugging Face API');

    const buffer = Buffer.from(await response.arrayBuffer());
    tempFilePath = path.join(os.tmpdir(), `image-${Date.now()}.png`);
    fs.writeFileSync(tempFilePath, buffer);

    console.log('Image saved to temp file:', tempFilePath);

    // Upload ảnh mới lên Cloudinary
    const uploadResult = await cloudinary.uploader.upload(tempFilePath, {
      folder: 'video-generator',
      resource_type: 'image',
      transformation: [{ width: 1024, height: 1024, crop: 'fill' }]
    });

    console.log('Image uploaded to Cloudinary:', uploadResult.secure_url);

    // Cập nhật URL và trạng thái vào cơ sở dữ liệu
    image.url = uploadResult.secure_url;
    image.status = 'generated';
    image.updatedAt = new Date();
    await image.save();

    // Dọn dẹp file tạm
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    return {
      status: 'success',
      data: {
        imageId: image._id,
        url: image.url,
        status: image.status,
        prompt: image.prompt,
        style: image.style,
        resolution: image.resolution,
        scriptId: image.scriptId,
        splitScriptId: image.splitScriptId,
        order: image.order,
        createdAt: image.createdAt,
        updatedAt: image.updatedAt, 
      }
    };
  } catch (error) {
    console.error('Error during image regeneration process:', error);  // Log error here
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    throw new Error(`Failed to regenerate image: ${error.message}`);
  }
};

const getImageById = async (imageId) => {
  try {
    // Truy vấn thông tin ảnh từ database
    const image = await Image.findById(imageId);

    if (!image) {
      return null;
    }

    // Trả về thông tin ảnh
    return {
      id: image.id,
      scriptId: image.scriptId,
      splitScriptId: image.splitScriptId,
      style: image.style,
      resolution: image.resolution,
      prompt: image.prompt,
      url: image.url,
      status: image.status,
      order: image.order,
      createdAt: image.createdAt,
      updatedAt: image.updatedAt,
    };
  } catch (error) {
    console.error('Error in getImageById service:', error);
    throw new Error('Failed to retrieve image from database');
  }
};

const getImagesByScriptId = async (scriptId) => {
  try {
    console.log('Fetching images for Script ID:', scriptId);

    // Kiểm tra xem scriptId có phải là ObjectId hợp lệ không
    if (!mongoose.Types.ObjectId.isValid(scriptId)) {
      throw new Error('Invalid Script ID format');
    }

    // Chuyển đổi scriptId thành ObjectId
    const objectId = new mongoose.Types.ObjectId(scriptId);

    // Truy vấn danh sách ảnh từ database
    const images = await Image.find({ scriptId: objectId });

    if (!images || images.length === 0) {
      return [];
    }

    // Trả về danh sách ảnh
    return images.map((image) => ({
      id: image._id,
      url: image.url,
      status: image.status,
      prompt: image.prompt,
      style: image.style,
      resolution: image.resolution,
      order: image.order,
      createdAt: image.createdAt,
      updatedAt: image.updatedAt,
    }));
  } catch (error) {
    console.error('Error in getImagesByScriptId service:', error);
    throw new Error('Failed to retrieve images by Script ID');
  }
};

const getImagesBySplitScriptId = async (splitScriptId) => {
  try {
    console.log('Fetching images for Split Script ID:', splitScriptId);

    // Kiểm tra xem splitScriptId có phải là ObjectId hợp lệ không
    if (!mongoose.Types.ObjectId.isValid(splitScriptId)) {
      throw new Error('Invalid Split Script ID format');
    }

    // Chuyển đổi splitScriptId thành ObjectId
    const objectId = new mongoose.Types.ObjectId(splitScriptId);

    // Truy vấn danh sách ảnh từ database
    const images = await Image.find({ splitScriptId: objectId });

    if (!images || images.length === 0) {
      return [];
    }

    // Trả về danh sách ảnh
    return images.map((image) => ({
      id: image._id,
      url: image.url,
      status: image.status,
      prompt: image.prompt,
      style: image.style,
      resolution: image.resolution,
      order: image.order,
      createdAt: image.createdAt,
      updatedAt: image.updatedAt,

    }));
  } catch (error) {
    console.error('Error in getImagesBySplitScriptId service:', error);
    throw new Error('Failed to retrieve images by Split Script ID');
  }
};

// Add new function to check job status
const checkJobStatus = async (jobId) => {
    try {
        const job = await Job.findOne({ jobId });
        if (!job) {
            throw new Error('Job not found');
        }

        // Get all images for this script
        const images = await Image.find({ 
            scriptId: job.scriptId 
        });

        return {
            status: 'success',
            data: {
                jobId: job.jobId,
                scriptId: job.scriptId,
                userId: job.userId,
                totalImages: job.totalImages,
                completedImages: job.completedImages,
                status: job.status,
                images: images.map(img => ({
                    imageId: img._id,
                    url: img.url,
                    status: img.status,
                    prompt: img.prompt,
                    style: img.style,
                    resolution: img.resolution
                })),
                createdAt: job.createdAt,
                updatedAt: job.updatedAt
            }
        };
    } catch (error) {
        console.error('Error in checkJobStatus:', error);
        return {
            status: 'error',
            error: error.message
        };
    }
};

module.exports = {
  generateImage,
  checkImageStatus,
  updateEditedImage,
  regenerateImage,
  getImageById,
  getImagesByScriptId,
  getImagesBySplitScriptId,
  checkJobStatus
};
