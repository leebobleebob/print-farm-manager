const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const REQUIRED_CAPABILITIES = ['listFiles', 'uploadFile', 'startFile', 'deleteFile'];

function requireBareFilename(filename) {
  if (!filename || filename !== path.basename(filename) || /[\\/]/.test(filename)) {
    throw new Error('Fleet Send filename must be a bare filename');
  }
  return filename;
}

function publicSession(session) {
  return {
    id: session.id,
    model: session.model,
    filename: session.filename,
    size: session.size,
    action: session.action,
    requiredMaterial: session.requiredMaterial,
    requiredColor: session.requiredColor,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    consumed: session.consumed,
    targets: session.targets.map((target) => ({ ...target })),
    progress: { ...session.progress },
  };
}

class FleetSendStore extends EventEmitter {
  constructor(db, options = {}) {
    super();
    this.db = db;
    this.root = options.root;
    this.getDriver = options.getDriver;
    this.now = options.now || Date.now;
    this.ttlMs = options.ttlMs || 30 * 60 * 1000;
    this.concurrency = Math.max(1, options.concurrency || 4);
    this.verifyAttempts = Math.max(1, options.verifyAttempts || 3);
    this.verifyDelayMs = Math.max(0, options.verifyDelayMs || 0);
    this.sessions = new Map();

    if (!this.root) throw new Error('FleetSendStore root is required');
    if (typeof this.getDriver !== 'function') throw new Error('FleetSendStore getDriver is required');
    fs.mkdirSync(this.root, { recursive: true });
  }

  _printer(id) {
    return this.db.prepare('SELECT * FROM printers WHERE id = ?').get(id);
  }

  _capabilityError(driver) {
    const missing = REQUIRED_CAPABILITIES.filter((method) => typeof driver[method] !== 'function');
    return missing.length ? `Driver does not support Fleet Send (${missing.join(', ')})` : null;
  }

  _localBlock(printer, sessionLike) {
    if (!printer.is_active) return { state: 'inactive', message: 'Printer is out of active service' };
    if (printer.is_held) return { state: 'held', message: 'Printer is held for operator review' };
    if (printer.model !== sessionLike.model) {
      return { state: 'incompatible', message: 'Printer no longer matches the exact file model' };
    }
    if (printer.status !== 'IDLE') return { state: 'busy', message: `Printer is ${printer.status}` };
    if (sessionLike.requiredMaterial && printer.loaded_material !== sessionLike.requiredMaterial) {
      return {
        state: 'filament_mismatch',
        message: `Printer has ${printer.loaded_material || 'unknown material'} loaded; ${sessionLike.requiredMaterial} is required`,
      };
    }
    if (sessionLike.requiredColor && printer.loaded_color !== sessionLike.requiredColor) {
      return {
        state: 'filament_mismatch',
        message: `Printer has ${printer.loaded_color || 'unknown color'} loaded; ${sessionLike.requiredColor} is required`,
      };
    }
    return null;
  }

  _progress(session, printerId, stage, message, bytesSent = 0) {
    const event = {
      printerId,
      stage,
      message,
      bytesSent,
      totalBytes: session.size,
      percent: session.size ? Math.max(0, Math.min(100, Math.round(bytesSent * 100 / session.size))) : 0,
    };
    session.progress[printerId] = event;
    this.emit('progress', { sessionId: session.id, ...event });
  }

  async _mapLimited(items, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async preflight(request) {
    const model = String(request.model || '').trim();
    const filename = requireBareFilename(String(request.filename || ''));
    const action = request.action;
    const printerIds = request.printerIds || [];
    if (!model) throw new Error('Fleet Send exact model is required');
    if (!['upload', 'upload_print'].includes(action)) {
      throw new Error('Fleet Send action must be upload or upload_print');
    }
    if (!Array.isArray(printerIds) || printerIds.length === 0) {
      throw new Error('Select at least one printer');
    }
    if (new Set(printerIds.map(String)).size !== printerIds.length) {
      throw new Error('A printer can only be selected once');
    }

    const printers = printerIds.map((id) => {
      const printer = this._printer(id);
      if (!printer) throw new Error(`Unknown printer: ${id}`);
      return printer;
    });
    if (printers.some((printer) => printer.model !== model)) {
      throw new Error('Every selected printer must match the exact model');
    }

    const sourcePath = request.sourcePath;
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile() || stat.size === 0) throw new Error('Fleet Send file is empty or missing');

    for (const printer of printers) {
      const driver = this.getDriver(printer.type);
      const capabilityError = this._capabilityError(driver);
      if (!capabilityError) {
        const extension = path.extname(filename).toLowerCase();
        const accepted = driver.acceptedExtensions || [];
        if (accepted.length && !accepted.includes(extension)) {
          throw new Error(`${printer.name} does not accept ${extension || 'this file type'}`);
        }
      }
    }

    const id = crypto.randomUUID();
    const sessionDir = path.join(this.root, id);
    const stagedPath = path.join(sessionDir, filename);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.copyFileSync(sourcePath, stagedPath);
    const createdAt = this.now();
    const base = {
      id,
      model,
      filename,
      size: fs.statSync(stagedPath).size,
      digest: crypto.createHash('sha256').update(fs.readFileSync(stagedPath)).digest('hex'),
      action,
      requiredMaterial: request.requiredMaterial || null,
      requiredColor: request.requiredColor || null,
      stagedPath,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      consumed: false,
      targets: [],
      progress: {},
    };

    base.targets = await this._mapLimited(printers, async (printer) => {
      const localBlock = this._localBlock(printer, base);
      if (localBlock) return { printerId: printer.id, printerName: printer.name, ...localBlock };
      const driver = this.getDriver(printer.type);
      const capabilityError = this._capabilityError(driver);
      if (capabilityError) {
        return { printerId: printer.id, printerName: printer.name, state: 'unsupported', message: capabilityError };
      }
      try {
        const files = await driver.listFiles(printer);
        const existing = files.find((file) => file.filename === filename);
        if (!existing) {
          return { printerId: printer.id, printerName: printer.name, state: 'ready', message: 'Ready to upload' };
        }
        const sameSize = Number(existing.size) === base.size;
        return {
          printerId: printer.id,
          printerName: printer.name,
          state: sameSize ? 'conflict_same_size' : 'conflict_different_size',
          message: sameSize ? 'Same filename and size already exist' : 'Same filename already exists',
          existingSize: Number(existing.size),
        };
      } catch (error) {
        return { printerId: printer.id, printerName: printer.name, state: 'failed', message: error.message };
      }
    });

    for (const target of base.targets) {
      this._progress(base, target.printerId, 'preflight', target.message, 0);
    }
    this.sessions.set(id, base);
    return publicSession(base);
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Fleet Send session not found');
    if (this.now() >= session.expiresAt) {
      this.cancel(id);
      throw new Error('Fleet Send session expired');
    }
    return session;
  }

  getPublic(id) {
    return publicSession(this.get(id));
  }

  cancel(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    fs.rmSync(path.dirname(session.stagedPath), { recursive: true, force: true });
  }

  async _verify(driver, printer, session, remoteName) {
    for (let attempt = 1; attempt <= this.verifyAttempts; attempt++) {
      this._progress(session, printer.id, 'verifying', `Verifying upload (${attempt}/${this.verifyAttempts})`, session.size);
      const files = await driver.listFiles(printer);
      if (files.some((file) => file.filename === remoteName && Number(file.size) === session.size)) {
        return true;
      }
      if (attempt < this.verifyAttempts && this.verifyDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.verifyDelayMs * attempt));
      }
    }
    return false;
  }

  async execute(id, decisions = {}) {
    const session = this.get(id);
    if (session.consumed) throw new Error('Fleet Send session was already executed');

    const conflicts = session.targets.filter((target) => target.state.startsWith('conflict_'));
    for (const target of conflicts) {
      const decision = decisions[target.printerId];
      if (!['replace', 'skip'].includes(decision)) {
        throw new Error(`A replace or skip decision is required for ${target.printerName}`);
      }
    }
    session.consumed = true;

    const targets = await this._mapLimited(session.targets, async (target) => {
      if (!['ready', 'conflict_same_size', 'conflict_different_size'].includes(target.state)) {
        return { printerId: target.printerId, state: target.state, message: target.message };
      }
      if (target.state.startsWith('conflict_') && decisions[target.printerId] === 'skip') {
        this._progress(session, target.printerId, 'skipped', 'Existing file kept; printer skipped', 0);
        return { printerId: target.printerId, state: 'skipped', message: 'Existing file kept' };
      }

      try {
        let printer = this._printer(target.printerId);
        const freshBlock = this._localBlock(printer, session);
        if (freshBlock) {
          this._progress(session, printer.id, freshBlock.state, freshBlock.message, 0);
          return { printerId: printer.id, ...freshBlock };
        }
        const driver = this.getDriver(printer.type);
        const capabilityError = this._capabilityError(driver);
        if (capabilityError) throw new Error(capabilityError);

        if (target.state.startsWith('conflict_')) {
          this._progress(session, printer.id, 'replacing', 'Removing confirmed duplicate', 0);
          await driver.deleteFile(printer, session.filename);
        }

        this._progress(session, printer.id, 'uploading', 'Uploading', 0);
        const remoteName = await driver.uploadFile(
          printer,
          session.stagedPath,
          session.filename,
          {
            onProgress: (sent) => this._progress(session, printer.id, 'uploading', 'Uploading', sent),
          }
        );
        if (!await this._verify(driver, printer, session, remoteName)) {
          throw new Error('Upload could not be verified by filename and size');
        }

        if (session.action === 'upload') {
          this._progress(session, printer.id, 'uploaded', 'Upload verified; print not started', session.size);
          return { printerId: printer.id, state: 'uploaded', message: 'Upload verified; print not started' };
        }

        printer = this._printer(target.printerId);
        const preStartBlock = this._localBlock(printer, session);
        if (preStartBlock) {
          this._progress(session, printer.id, preStartBlock.state, `Upload verified; ${preStartBlock.message}`, session.size);
          return { printerId: printer.id, ...preStartBlock };
        }
        const liveStatus = await driver.getStatus(printer);
        if (liveStatus.status !== 'IDLE') {
          const message = `Upload verified; printer is ${liveStatus.status}`;
          this._progress(session, printer.id, 'busy', message, session.size);
          return { printerId: printer.id, state: 'busy', message };
        }

        this._progress(session, printer.id, 'starting', 'Starting verified current file', session.size);
        await driver.startFile(printer, remoteName);
        this._progress(session, printer.id, 'started', 'Print started', session.size);
        return { printerId: printer.id, state: 'started', message: 'Print started' };
      } catch (error) {
        this._progress(session, target.printerId, 'failed', error.message, 0);
        return { printerId: target.printerId, state: 'failed', message: error.message };
      }
    });

    return { ...publicSession(session), targets };
  }
}

module.exports = FleetSendStore;
