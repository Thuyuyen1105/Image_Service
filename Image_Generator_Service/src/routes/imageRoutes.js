const express = require('express');
const router = express.Router();
const imageController = require('../controllers/imageController');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Cấu hình upload

//tạo ảnh mới
router.post('/generate', imageController.generateImage);
router.get('/status/:imageId', imageController.checkImageStatus);

//cập nhật lại ảnh sau khi đã edit
router.patch('/update/:imageId', upload.single('image'), imageController.updateEditedImage);
router.post('/regenerate/:imageId', imageController.regenerateImage);

//xem ảnh theo imageid
router.get('/view/image/:imageId', imageController.viewImage);

//lấy danh sách ảnh theo scriptid
router.get('/view/script/:scriptId', imageController.viewImageByScriptId);

//xem ảnh theo splitscriptid
router.get('/view/split/:splitScriptId', imageController.viewImageBySplitScriptId);

// Check job status
router.get('/job/:jobId', imageController.checkJobStatus);

module.exports = router; 