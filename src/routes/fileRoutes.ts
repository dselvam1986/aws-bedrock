import express from 'express';
import multer from 'multer';
import { handleFileUpload } from '../controllers/fileController';

const router = express.Router();
const upload = multer({ dest: 'uploads/' }); // Files will be uploaded to the "uploads" folder

// Route to handle file uploads
router.post('/upload', upload.single('file'), handleFileUpload);
// router.post('/upload', upload.array('files'), handleFileUpload);

export default router;
