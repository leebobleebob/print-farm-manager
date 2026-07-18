const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const FleetSendStore = require('../fleet-send');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE printers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      ip TEXT NOT NULL,
      type TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      is_held INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      loaded_material TEXT,
      loaded_color TEXT
    );
    CREATE TABLE parts (
      id INTEGER PRIMARY KEY,
      completed_qty INTEGER NOT NULL
    );
    INSERT INTO parts (id, completed_qty) VALUES (1, 42);
  `);
  const insert = db.prepare(`
    INSERT INTO printers
      (id, name, ip, type, model, status, is_held, is_active, loaded_material, loaded_color)
    VALUES (?, ?, ?, 'elegoo-centauri', ?, ?, ?, ?, ?, ?)
  `);
  insert.run(1, 'One', '10.0.0.1', 'centauri-carbon', 'IDLE', 0, 1, 'PLA', 'Black');
  insert.run(2, 'Two', '10.0.0.2', 'centauri-carbon', 'IDLE', 0, 1, 'PLA', 'Black');
  insert.run(3, 'CC2', '10.0.0.3', 'centauri-carbon-2', 'IDLE', 0, 1, 'PLA', 'Black');
  return db;
}

function makeFile(root, name = 'part.gcode', contents = 'G28\n') {
  const file = path.join(root, name);
  fs.writeFileSync(file, contents);
  return file;
}

function makeDriver(remoteByPrinter = new Map()) {
  return {
    acceptedExtensions: ['.gcode'],
    listFiles: jest.fn(async (printer) => remoteByPrinter.get(printer.id) || []),
    uploadFile: jest.fn(async (printer, filePath, remoteName, options = {}) => {
      const size = fs.statSync(filePath).size;
      options.onProgress?.(size, size);
      remoteByPrinter.set(printer.id, [{ filename: remoteName, size }]);
      return remoteName;
    }),
    startFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn(async (printer, remoteName) => {
      remoteByPrinter.set(
        printer.id,
        (remoteByPrinter.get(printer.id) || []).filter((file) => file.filename !== remoteName)
      );
    }),
    getStatus: jest.fn().mockResolvedValue({ status: 'IDLE' }),
  };
}

describe('FleetSendStore', () => {
  let db;
  let root;
  let sourceRoot;
  let driver;
  let store;

  beforeEach(() => {
    db = makeDb();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-send-store-'));
    sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-send-source-'));
    driver = makeDriver();
    store = new FleetSendStore(db, {
      root,
      getDriver: () => driver,
      verifyAttempts: 2,
      verifyDelayMs: 0,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  });

  test('preflights one staged file across ready and duplicate targets', async () => {
    const source = makeFile(sourceRoot);
    const size = fs.statSync(source).size;
    driver.listFiles.mockImplementation(async (printer) => (
      printer.id === 2 ? [{ filename: 'part.gcode', size }] : []
    ));

    const session = await store.preflight({
      model: 'centauri-carbon',
      printerIds: [1, 2],
      sourcePath: source,
      filename: 'part.gcode',
      action: 'upload_print',
      requiredMaterial: 'PLA',
      requiredColor: 'Black',
    });

    expect(session.targets).toEqual([
      expect.objectContaining({ printerId: 1, state: 'ready' }),
      expect.objectContaining({ printerId: 2, state: 'conflict_same_size' }),
    ]);
    expect(session.filename).toBe('part.gcode');
    expect(fs.existsSync(path.join(root, session.id, 'part.gcode'))).toBe(true);
  });

  test('rejects mixed printer models before any remote inspection', async () => {
    const source = makeFile(sourceRoot);
    await expect(store.preflight({
      model: 'centauri-carbon',
      printerIds: [1, 3],
      sourcePath: source,
      filename: 'part.gcode',
      action: 'upload',
    })).rejects.toThrow('exact model');
    expect(driver.listFiles).not.toHaveBeenCalled();
  });

  test('blocks a recorded filament mismatch with no remote mutation', async () => {
    db.prepare("UPDATE printers SET loaded_material = 'PETG' WHERE id = 2").run();
    const source = makeFile(sourceRoot);
    const session = await store.preflight({
      model: 'centauri-carbon',
      printerIds: [2],
      sourcePath: source,
      filename: 'part.gcode',
      action: 'upload_print',
      requiredMaterial: 'PLA',
    });

    expect(session.targets[0]).toEqual(expect.objectContaining({
      state: 'filament_mismatch',
      message: expect.stringContaining('PETG'),
    }));
    expect(driver.listFiles).not.toHaveBeenCalled();
  });

  test('upload only replaces the confirmed duplicate and never starts printers', async () => {
    const source = makeFile(sourceRoot);
    const size = fs.statSync(source).size;
    const remote = new Map([[2, [{ filename: 'part.gcode', size: size + 10 }]]]);
    driver = makeDriver(remote);
    store = new FleetSendStore(db, { root, getDriver: () => driver, verifyDelayMs: 0 });

    const session = await store.preflight({
      model: 'centauri-carbon', printerIds: [1, 2], sourcePath: source,
      filename: 'part.gcode', action: 'upload', requiredMaterial: 'PLA',
    });
    const result = await store.execute(session.id, { 2: 'replace' });

    expect(result.targets).toEqual([
      expect.objectContaining({ printerId: 1, state: 'uploaded' }),
      expect.objectContaining({ printerId: 2, state: 'uploaded' }),
    ]);
    expect(driver.deleteFile).toHaveBeenCalledTimes(1);
    expect(driver.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), 'part.gcode');
    expect(driver.uploadFile).toHaveBeenCalledTimes(2);
    expect(driver.startFile).not.toHaveBeenCalled();
    expect(db.prepare('SELECT completed_qty FROM parts WHERE id = 1').get().completed_qty).toBe(42);
  });

  test('requires every duplicate decision and consumes execution only once', async () => {
    const source = makeFile(sourceRoot);
    const size = fs.statSync(source).size;
    driver.listFiles.mockResolvedValue([{ filename: 'part.gcode', size }]);
    const session = await store.preflight({
      model: 'centauri-carbon', printerIds: [1], sourcePath: source,
      filename: 'part.gcode', action: 'upload',
    });

    await expect(store.execute(session.id, {})).rejects.toThrow('decision');
    await store.execute(session.id, { 1: 'skip' });
    await expect(store.execute(session.id, { 1: 'replace' })).rejects.toThrow('already executed');
  });

  test('fresh checks start only the verified target that is still idle', async () => {
    const source = makeFile(sourceRoot);
    const session = await store.preflight({
      model: 'centauri-carbon', printerIds: [1, 2], sourcePath: source,
      filename: 'part.gcode', action: 'upload_print', requiredMaterial: 'PLA',
    });
    db.prepare("UPDATE printers SET status = 'PRINTING' WHERE id = 2").run();

    const result = await store.execute(session.id, {});

    expect(result.targets).toEqual([
      expect.objectContaining({ printerId: 1, state: 'started' }),
      expect.objectContaining({ printerId: 2, state: 'busy' }),
    ]);
    expect(driver.uploadFile).toHaveBeenCalledTimes(1);
    expect(driver.startFile).toHaveBeenCalledTimes(1);
    expect(driver.startFile).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'part.gcode');
  });
});

