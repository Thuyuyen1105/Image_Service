const { HfInference } = require('@huggingface/inference');
const cloudinary = require('cloudinary').v2;
const Image = require('../models/Image');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const os = require('os');
const mongoose = require('mongoose');

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

const generateImage = async (prompt, style = 'realistic', resolution = '1024x1024', scriptId, splitScriptId, order) => {
  if (!prompt || !scriptId || order === undefined) {
    throw new Error('Prompt, scriptId, and order are required');
  }

  let image = null;
  let tempFilePath = null;

  try {
    // Lưu ảnh vào database với trạng thái "processing"
    image = new Image({ prompt, style, resolution, scriptId, splitScriptId, order, status: 'processing', url: '' });
    await image.save();

    // Tạo prompt nâng cao
    const styleDescription = {
      realistic: 'in a photorealistic style with high detail and natural lighting',
      cartoon: 'in a vibrant cartoon style with bold colors and clean lines',
      anime: 'in an anime art style with expressive features and dynamic composition',
      watercolor: 'in a soft watercolor painting style with flowing colors and gentle brushstrokes',
      'oil painting': 'in an oil painting style with rich textures and classical composition'
    }[style.toLowerCase()] || `in a ${style} style`;

    const enhancedPrompt = `${prompt}, ${styleDescription}, high quality, detailed, professional`;

    // Gọi API Hugging Face để tạo ảnh
    const response = await hf.textToImage({
      model: 'stabilityai/stable-diffusion-xl-base-1.0',
      inputs: enhancedPrompt,
      parameters: {
        negative_prompt: 'low quality, blurry, distorted',
        num_inference_steps: 50,
        guidance_scale: 7.5
      }
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    tempFilePath = path.join(os.tmpdir(), `image-${Date.now()}.png`);
    fs.writeFileSync(tempFilePath, buffer);

    // Upload ảnh lên Cloudinary
    const uploadResult = await cloudinary.uploader.upload(tempFilePath, {
      folder: 'video-generator',
      resource_type: 'image',
      transformation: [{ width: 1024, height: 1024, crop: 'fill' }]
    });

    // Cập nhật URL và trạng thái vào cơ sở dữ liệu
    image.url = uploadResult.secure_url;
    image.status = 'generated';
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
      }
    };
  } catch (error) {
    if (image) {
      image.status = 'failed';
      image.error = error.message;
      await image.save();
    }

    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    throw new Error(`Failed to generate image: ${error.message}`);
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

module.exports = {
  generateImage,
  checkImageStatus,
  updateEditedImage,
  regenerateImage,
  getImageById,
  getImagesByScriptId,
  getImagesBySplitScriptId,
};
