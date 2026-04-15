const express = require('express');
const multer = require('multer');
const storage = require('../lib/storage');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// In-memory upload, capped at 25 MB — plenty for invoices/contracts.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// POST /api/files — upload a file.
// multipart/form-data with a single "file" field.
// Returns { file_reference, download_url, filename, size, mimeType }.
router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file field required' });
    const saved = await storage.save(req.file.buffer, {
      filename: req.file.originalname || 'upload',
      mimeType: req.file.mimetype || 'application/octet-stream',
    });
    res.status(201).json({
      file_reference: saved.reference,
      download_url: `/api/files/${encodeURIComponent(saved.reference)}`,
      filename: saved.filename,
      mimeType: saved.mimeType,
      size: saved.size,
    });
  } catch (err) { next(err); }
});

// GET /api/files/:reference — authenticated download.
router.get('/:reference', requireAuth, async (req, res, next) => {
  try {
    const { buffer, filename, mimeType } = await storage.read(req.params.reference);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(err);
  }
});

module.exports = router;
