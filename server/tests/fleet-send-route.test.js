const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const makeFleetSendRouter = require('../routes/fleet-send');

describe('Fleet Send routes', () => {
  let app;
  let store;
  let uploadRoot;

  beforeEach(() => {
    uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-send-route-'));
    store = {
      preflight: jest.fn(async (input) => {
        expect(fs.existsSync(input.sourcePath)).toBe(true);
        return { id: 'session-1', filename: input.filename, targets: [] };
      }),
      getPublic: jest.fn(() => ({ id: 'session-1', consumed: false, targets: [] })),
      execute: jest.fn(async (_id, decisions) => ({ id: 'session-1', decisions, targets: [] })),
      cancel: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };
    app = express();
    app.use(express.json());
    app.use('/api/fleet-send', makeFleetSendRouter(store, { uploadRoot }));
  });

  afterEach(() => fs.rmSync(uploadRoot, { recursive: true, force: true }));

  test('creates multipart preflight and removes the temporary incoming file', async () => {
    const response = await request(app)
      .post('/api/fleet-send/preflight')
      .field('model', 'centauri-carbon')
      .field('printer_ids', JSON.stringify([1, 2]))
      .field('action', 'upload_print')
      .field('required_material', 'PLA')
      .field('required_color', 'Black')
      .attach('file', Buffer.from('G28\n'), 'part.gcode');

    expect(response.status).toBe(201);
    expect(response.body.id).toBe('session-1');
    expect(store.preflight).toHaveBeenCalledWith(expect.objectContaining({
      model: 'centauri-carbon',
      printerIds: [1, 2],
      filename: 'part.gcode',
      action: 'upload_print',
      requiredMaterial: 'PLA',
      requiredColor: 'Black',
    }));
    expect(fs.readdirSync(uploadRoot)).toEqual([]);
  });

  test('rejects malformed printer selection without calling the store', async () => {
    const response = await request(app)
      .post('/api/fleet-send/preflight')
      .field('model', 'centauri-carbon')
      .field('printer_ids', 'not-json')
      .field('action', 'upload')
      .attach('file', Buffer.from('G28\n'), 'part.gcode');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/printer_ids/);
    expect(store.preflight).not.toHaveBeenCalled();
    expect(fs.readdirSync(uploadRoot)).toEqual([]);
  });

  test('returns public session state', async () => {
    const response = await request(app).get('/api/fleet-send/session-1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'session-1', consumed: false, targets: [] });
  });

  test('executes one confirmed decision map', async () => {
    const response = await request(app)
      .post('/api/fleet-send/session-1/execute')
      .send({ confirmed: true, decisions: { 2: 'replace' } });

    expect(response.status).toBe(200);
    expect(store.execute).toHaveBeenCalledWith('session-1', { 2: 'replace' });
  });

  test('requires explicit confirmation before execution', async () => {
    const response = await request(app)
      .post('/api/fleet-send/session-1/execute')
      .send({ decisions: {} });
    expect(response.status).toBe(400);
    expect(store.execute).not.toHaveBeenCalled();
  });

  test('cancels a session', async () => {
    const response = await request(app).delete('/api/fleet-send/session-1');
    expect(response.status).toBe(204);
    expect(store.cancel).toHaveBeenCalledWith('session-1');
  });
});

