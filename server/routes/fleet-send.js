const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');

function statusFor(error) {
  if (/not found/i.test(error.message)) return 404;
  if (/expired/i.test(error.message)) return 410;
  return 400;
}

module.exports = (store, options = {}) => {
  const router = express.Router();
  const uploadRoot = options.uploadRoot || path.join(__dirname, '..', 'data', 'fleet-send-incoming');
  fs.mkdirSync(uploadRoot, { recursive: true });
  const upload = multer({
    dest: uploadRoot,
    limits: { files: 1, fileSize: 4 * 1024 * 1024 * 1024 },
  });

  router.post('/preflight', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'file is required' });
      let printerIds;
      try {
        printerIds = JSON.parse(req.body.printer_ids);
      } catch (_) {
        return res.status(400).json({ error: 'printer_ids must be a JSON array' });
      }
      if (!Array.isArray(printerIds)) {
        return res.status(400).json({ error: 'printer_ids must be a JSON array' });
      }

      const session = await store.preflight({
        model: req.body.model,
        printerIds,
        sourcePath: req.file.path,
        filename: path.basename(req.file.originalname),
        action: req.body.action,
        requiredMaterial: req.body.required_material || null,
        requiredColor: req.body.required_color || null,
      });
      res.status(201).json(session);
    } catch (error) {
      res.status(statusFor(error)).json({ error: error.message });
    } finally {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    }
  });

  router.get('/:id/events', (req, res) => {
    try {
      store.getPublic(req.params.id);
    } catch (error) {
      return res.status(statusFor(error)).json({ error: error.message });
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders?.();
    const listener = (event) => {
      if (event.sessionId === req.params.id) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };
    store.on('progress', listener);
    req.on('close', () => store.off('progress', listener));
  });

  router.get('/:id', (req, res) => {
    try {
      res.json(store.getPublic(req.params.id));
    } catch (error) {
      res.status(statusFor(error)).json({ error: error.message });
    }
  });

  router.post('/:id/execute', async (req, res) => {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({ error: 'Explicit confirmation is required' });
    }
    try {
      res.json(await store.execute(req.params.id, req.body.decisions || {}));
    } catch (error) {
      res.status(statusFor(error)).json({ error: error.message });
    }
  });

  router.delete('/:id', (req, res) => {
    store.cancel(req.params.id);
    res.status(204).end();
  });

  return router;
};

