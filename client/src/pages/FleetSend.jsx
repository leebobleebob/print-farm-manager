import { useEffect, useMemo, useRef, useState } from 'react';
import './FleetSend.css';

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
const DEMO_PRINTERS = [
  { id: 1, name: 'Frank', ip: '192.168.5.102', type: 'elegoo-centauri', model: 'centauri-carbon', status: 'IDLE', is_held: 0, is_active: 1, loaded_material: 'PLA', loaded_color: 'Black' },
  { id: 2, name: 'Bento', ip: '192.168.5.110', type: 'elegoo-centauri', model: 'centauri-carbon', status: 'IDLE', is_held: 0, is_active: 1, loaded_material: 'PLA', loaded_color: 'Black' },
  { id: 3, name: 'NoGlass', ip: '192.168.5.63', type: 'elegoo-centauri', model: 'centauri-carbon', status: 'IDLE', is_held: 0, is_active: 1, loaded_material: 'PETG', loaded_color: 'Orange' },
  { id: 4, name: 'AlmostPerfect', ip: '192.168.5.104', type: 'elegoo-centauri', model: 'centauri-carbon', status: 'PRINTING', is_held: 0, is_active: 1, loaded_material: 'PLA', loaded_color: 'White' },
  { id: 5, name: 'Newish', ip: '192.168.5.64', type: 'elegoo-centauri', model: 'centauri-carbon', status: 'IDLE', is_held: 0, is_active: 1, loaded_material: 'PLA Rapid +', loaded_color: 'Gray' },
  { id: 6, name: 'CC2 Test Unit', ip: '192.168.5.80', type: 'elegoo-centauri2', model: 'centauri-carbon-2', status: 'IDLE', is_held: 0, is_active: 1, loaded_material: 'PLA', loaded_color: 'Black' },
];
const DEMO_TYPES = ['PLA', 'PLA Rapid +', 'PETG', 'PETG-CF'].map((name, index) => ({ id: index + 1, name }));
const DEMO_COLORS = [
  { id: 1, type_name: 'PLA', name: 'Black' },
  { id: 2, type_name: 'PLA', name: 'White' },
  { id: 3, type_name: 'PLA Rapid +', name: 'Gray' },
  { id: 4, type_name: 'PETG', name: 'Orange' },
];

const MODEL_LABELS = {
  'centauri-carbon': 'Centauri Carbon',
  'centauri-carbon-2': 'Centauri Carbon 2',
};

const STATE_LABELS = {
  ready: 'Ready',
  conflict_same_size: 'Duplicate · same size',
  conflict_different_size: 'Duplicate · different size',
  preflight: 'Preflight',
  replacing: 'Replacing',
  uploading: 'Uploading',
  verifying: 'Verifying',
  starting: 'Starting',
  started: 'Print started',
  uploaded: 'Upload verified',
  skipped: 'Skipped',
  busy: 'Busy',
  held: 'Held',
  inactive: 'Out of service',
  incompatible: 'Incompatible',
  filament_mismatch: 'Check filament',
  unsupported: 'Not supported',
  failed: 'Failed',
};

function modelLabel(model) {
  return MODEL_LABELS[model] || model.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isEligible(printer) {
  return printer.status === 'IDLE' && printer.is_held === 0 && printer.is_active !== 0;
}

function ProgressRow({ target, progress }) {
  const stage = progress?.stage || target.state;
  const percent = progress?.percent || 0;
  const message = progress?.message || target.message;
  return (
    <div className={`send-progress-row state-${stage}`}>
      <div className="send-progress-copy">
        <strong>{target.printerName}</strong>
        <span>{STATE_LABELS[stage] || stage}</span>
      </div>
      <div className="send-progress-track" aria-label={`${target.printerName} ${percent}%`}>
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="send-progress-detail">
        <span>{message}</span>
        <code>{percent}%</code>
      </div>
    </div>
  );
}

function ConflictHud({ session, decisions, setDecision, onContinue, onCancel }) {
  const conflicts = session.targets.filter((target) => target.state.startsWith('conflict_'));
  return (
    <div className="conflict-backdrop" role="presentation">
      <section className="conflict-hud" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <header>
          <div>
            <p className="send-kicker">DUPLICATE CONTROL / {modelLabel(session.model).toUpperCase()}</p>
            <h2 id="conflict-title">Resolve {conflicts.length} existing file{conflicts.length === 1 ? '' : 's'}</h2>
            <p>Queue one decision for every printer, then continue to the fleet confirmation.</p>
          </div>
          <span className="session-file">{session.filename}</span>
        </header>

        <div className="conflict-list">
          {conflicts.map((target) => (
            <article key={target.printerId} className="conflict-row">
              <div>
                <strong>{target.printerName}</strong>
                <span>{target.message}{target.existingSize != null ? ` · ${target.existingSize.toLocaleString()} bytes` : ''}</span>
              </div>
              <div className="decision-switch" role="group" aria-label={`${target.printerName} duplicate decision`}>
                <button
                  type="button"
                  className={decisions[target.printerId] === 'replace' ? 'active replace' : ''}
                  onClick={() => setDecision(target.printerId, 'replace')}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className={decisions[target.printerId] === 'skip' ? 'active skip' : ''}
                  onClick={() => setDecision(target.printerId, 'skip')}
                >
                  Skip
                </button>
              </div>
            </article>
          ))}
        </div>

        <footer>
          <button type="button" className="send-button quiet" onClick={onCancel}>Cancel upload</button>
          <button type="button" className="send-button primary" onClick={onContinue}>Continue with decisions</button>
        </footer>
      </section>
    </div>
  );
}

export default function FleetSend() {
  const [printers, setPrinters] = useState([]);
  const [filamentTypes, setFilamentTypes] = useState([]);
  const [filamentColors, setFilamentColors] = useState([]);
  const [model, setModel] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [file, setFile] = useState(null);
  const [action, setAction] = useState('upload_print');
  const [material, setMaterial] = useState('');
  const [color, setColor] = useState('');
  const [session, setSession] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [showConflicts, setShowConflicts] = useState(false);
  const [phase, setPhase] = useState('setup');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    if (DEMO_MODE) {
      setPrinters(DEMO_PRINTERS);
      setFilamentTypes(DEMO_TYPES);
      setFilamentColors(DEMO_COLORS);
      setModel('centauri-carbon');
      setMaterial('PLA');
      setSelected(new Set([1, 2, 3]));
      setFile(new File(['; demo fleet send file\nG28\n'], 'drybox-roller-demo.gcode', { type: 'text/plain' }));
      setLoading(false);
      return;
    }
    Promise.all([
      fetch('/api/printers').then((response) => response.json()),
      fetch('/api/filaments/types').then((response) => response.json()).catch(() => []),
      fetch('/api/filaments/colors').then((response) => response.json()).catch(() => []),
    ]).then(([printerRows, types, colors]) => {
      setPrinters(printerRows);
      setFilamentTypes(types);
      setFilamentColors(colors);
      const models = [...new Set(printerRows.map((printer) => printer.model))];
      const preferred = models.includes('centauri-carbon') ? 'centauri-carbon' : models[0] || '';
      setModel(preferred);
    }).catch((fetchError) => setError(fetchError.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  const models = useMemo(() => [...new Set(printers.map((printer) => printer.model))].sort(), [printers]);
  const lanePrinters = useMemo(() => printers.filter((printer) => printer.model === model), [printers, model]);
  const selectedPrinters = lanePrinters.filter((printer) => selected.has(printer.id));
  const availableColors = filamentColors.filter((entry) => !material || entry.type_name === material);
  const selectedMismatchCount = selectedPrinters.filter((printer) => (
    (material && printer.loaded_material !== material) || (color && printer.loaded_color !== color)
  )).length;

  function switchModel(nextModel) {
    if (phase !== 'setup') return;
    setModel(nextModel);
    setSelected(new Set());
    setError('');
  }

  function togglePrinter(id) {
    if (phase !== 'setup') return;
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAllEligible() {
    setSelected(new Set(lanePrinters.filter(isEligible).map((printer) => printer.id)));
  }

  async function cancelSession() {
    eventSourceRef.current?.close();
    if (!DEMO_MODE && session?.id) await fetch(`/api/fleet-send/${session.id}`, { method: 'DELETE' }).catch(() => {});
    setSession(null);
    setDecisions({});
    setShowConflicts(false);
    setPhase('setup');
    setError('');
  }

  async function runPreflight(event) {
    event.preventDefault();
    setError('');
    if (!file) return setError('Choose one sliced file first.');
    if (!model) return setError('Choose an exact printer model.');
    if (selected.size === 0) return setError('Select at least one printer.');
    if (action === 'upload_print' && !material) {
      return setError('Choose the file material before Upload & print so filament can be checked.');
    }

    setPhase('preflighting');
    if (DEMO_MODE) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      const targets = selectedPrinters.map((printer, index) => {
        const mismatch = (material && printer.loaded_material !== material) || (color && printer.loaded_color !== color);
        if (mismatch) return { printerId: printer.id, printerName: printer.name, state: 'filament_mismatch', message: `Printer has ${printer.loaded_material} loaded; ${material} is required` };
        if (index === 1) return { printerId: printer.id, printerName: printer.name, state: 'conflict_same_size', message: 'Same filename and size already exist', existingSize: file.size };
        return { printerId: printer.id, printerName: printer.name, state: 'ready', message: 'Ready to upload' };
      });
      const demoSession = {
        id: 'demo-session', model, filename: file.name, size: file.size, action,
        targets,
        progress: Object.fromEntries(targets.map((target) => [target.printerId, { printerId: target.printerId, stage: 'preflight', message: target.message, percent: 0 }])),
      };
      setSession(demoSession);
      const conflicts = targets.filter((target) => target.state.startsWith('conflict_'));
      setDecisions(Object.fromEntries(conflicts.map((target) => [target.printerId, 'skip'])));
      setShowConflicts(conflicts.length > 0);
      setPhase('review');
      return;
    }
    const body = new FormData();
    body.append('file', file);
    body.append('model', model);
    body.append('printer_ids', JSON.stringify([...selected]));
    body.append('action', action);
    if (material) body.append('required_material', material);
    if (color) body.append('required_color', color);

    try {
      const response = await fetch('/api/fleet-send/preflight', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Preflight failed');
      setSession(data);
      const conflicts = data.targets.filter((target) => target.state.startsWith('conflict_'));
      setDecisions(Object.fromEntries(conflicts.map((target) => [target.printerId, 'skip'])));
      setShowConflicts(conflicts.length > 0);
      setPhase('review');
    } catch (preflightError) {
      setError(preflightError.message);
      setPhase('setup');
    }
  }

  function beginProgressStream(sessionId) {
    eventSourceRef.current?.close();
    const source = new EventSource(`/api/fleet-send/${sessionId}/events`);
    source.onmessage = (event) => {
      const update = JSON.parse(event.data);
      setSession((current) => current ? {
        ...current,
        progress: { ...current.progress, [update.printerId]: update },
      } : current);
    };
    source.onerror = () => {};
    eventSourceRef.current = source;
  }

  async function executeSession() {
    if (!session) return;
    setError('');
    setPhase('running');
    if (DEMO_MODE) {
      const runnable = session.targets.filter((target) => (
        target.state === 'ready' || (target.state.startsWith('conflict_') && decisions[target.printerId] === 'replace')
      ));
      const skipped = session.targets.filter((target) => target.state.startsWith('conflict_') && decisions[target.printerId] === 'skip');
      for (const target of skipped) {
        setSession((current) => ({ ...current, progress: { ...current.progress, [target.printerId]: { printerId: target.printerId, stage: 'skipped', message: 'Existing file kept; printer skipped', percent: 0 } } }));
      }
      for (const stage of [
        ['uploading', 'Uploading current file', 38],
        ['verifying', 'Verifying filename and byte size', 100],
        [action === 'upload_print' ? 'starting' : 'uploaded', action === 'upload_print' ? 'Starting verified current file' : 'Upload verified; print not started', 100],
        [action === 'upload_print' ? 'started' : 'uploaded', action === 'upload_print' ? 'Print started' : 'Upload verified; print not started', 100],
      ]) {
        await new Promise((resolve) => setTimeout(resolve, 420));
        setSession((current) => ({
          ...current,
          progress: {
            ...current.progress,
            ...Object.fromEntries(runnable.map((target) => [target.printerId, { printerId: target.printerId, stage: stage[0], message: stage[1], percent: stage[2] }])),
          },
        }));
      }
      setSession((current) => ({
        ...current,
        targets: current.targets.map((target) => {
          if (skipped.some((entry) => entry.printerId === target.printerId)) return { ...target, state: 'skipped', message: 'Existing file kept' };
          if (runnable.some((entry) => entry.printerId === target.printerId)) return { ...target, state: action === 'upload_print' ? 'started' : 'uploaded', message: action === 'upload_print' ? 'Print started' : 'Upload verified; print not started' };
          return target;
        }),
      }));
      setPhase('complete');
      return;
    }
    beginProgressStream(session.id);
    try {
      const response = await fetch(`/api/fleet-send/${session.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true, decisions }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Fleet Send failed');
      setSession((current) => ({
        ...current,
        ...data,
        targets: current.targets.map((target) => ({
          ...target,
          ...(data.targets.find((result) => result.printerId === target.printerId) || {}),
        })),
      }));
      setPhase('complete');
    } catch (executeError) {
      setError(executeError.message);
      setPhase('review');
    } finally {
      eventSourceRef.current?.close();
    }
  }

  if (loading) return <p className="send-loading">Loading Fleet Send…</p>;

  return (
    <div className="fleet-send-page">
      <header className="send-page-header">
        <div>
          <p className="send-kicker">DIRECT FLEET OPERATIONS</p>
          <h1>Fleet Send</h1>
          <p>One sliced file. One exact-model lane. Every selected printer checked before it can start.</p>
          {DEMO_MODE && <span className="demo-banner">Interactive preview · no printer commands are sent</span>}
        </div>
        <div className={`send-phase phase-${phase}`}>
          <i />
          <span>{phase === 'setup' ? 'Ready to stage' : phase.replaceAll('_', ' ')}</span>
        </div>
      </header>

      <form onSubmit={runPreflight} className="send-workbench">
        <section className="send-file-panel">
          <div className="send-section-heading">
            <span>01</span>
            <div><h2>File & action</h2><p>The staged file is immutable for this send.</p></div>
          </div>

          <label className={`send-dropzone ${file ? 'has-file' : ''}`}>
            <input
              type="file"
              accept=".gcode,.bgcode,.3mf"
              disabled={phase !== 'setup'}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <span className="drop-icon">＋</span>
            <strong>{file ? file.name : 'Choose sliced file'}</strong>
            <small>{file ? `${file.size.toLocaleString()} bytes` : '.gcode · .bgcode · .3mf'}</small>
          </label>

          <div className="action-choice" role="group" aria-label="Fleet Send action">
            <button type="button" className={action === 'upload' ? 'active' : ''} disabled={phase !== 'setup'} onClick={() => setAction('upload')}>
              <strong>Upload only</strong><span>Verify the file. Do not start.</span>
            </button>
            <button type="button" className={action === 'upload_print' ? 'active' : ''} disabled={phase !== 'setup'} onClick={() => setAction('upload_print')}>
              <strong>Upload & print</strong><span>Start only freshly verified uploads.</span>
            </button>
          </div>

          <div className="filament-checks">
            <label>
              <span>File material {action === 'upload_print' && <em>required</em>}</span>
              <select value={material} disabled={phase !== 'setup'} onChange={(event) => { setMaterial(event.target.value); setColor(''); }}>
                <option value="">Do not check</option>
                {filamentTypes.map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}
              </select>
            </label>
            <label>
              <span>Color <small>optional</small></span>
              <select value={color} disabled={phase !== 'setup' || !material} onChange={(event) => setColor(event.target.value)}>
                <option value="">Any color</option>
                {availableColors.map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="send-printer-panel">
          <div className="send-section-heading">
            <span>02</span>
            <div><h2>Exact-model targets</h2><p>Models stay in separate, incompatible lanes.</p></div>
          </div>

          <div className="model-tabs" role="tablist" aria-label="Printer model lanes">
            {models.map((entry) => (
              <button key={entry} type="button" role="tab" aria-selected={model === entry} className={model === entry ? 'active' : ''} onClick={() => switchModel(entry)}>
                <strong>{modelLabel(entry)}</strong>
                <span>{printers.filter((printer) => printer.model === entry).length} printers</span>
              </button>
            ))}
          </div>

          <div className="lane-toolbar">
            <span><strong>{selected.size}</strong> selected</span>
            {selectedMismatchCount > 0 && <span className="mismatch-warning">{selectedMismatchCount} filament check{selectedMismatchCount === 1 ? '' : 's'} needed</span>}
            <button type="button" disabled={phase !== 'setup'} onClick={selectAllEligible}>Select eligible</button>
            <button type="button" disabled={phase !== 'setup'} onClick={() => setSelected(new Set())}>Clear</button>
          </div>

          <div className="send-printer-grid">
            {lanePrinters.map((printer) => {
              const eligible = isEligible(printer);
              const mismatch = (material && printer.loaded_material !== material) || (color && printer.loaded_color !== color);
              return (
                <button
                  type="button"
                  key={printer.id}
                  className={`send-printer-card ${selected.has(printer.id) ? 'selected' : ''} ${!eligible ? 'unavailable' : ''} ${mismatch ? 'mismatch' : ''}`}
                  disabled={phase !== 'setup' || !eligible}
                  onClick={() => togglePrinter(printer.id)}
                >
                  <i className="selection-mark">{selected.has(printer.id) ? '✓' : ''}</i>
                  <span className="printer-card-main"><strong>{printer.name}</strong><small>{printer.ip}</small></span>
                  <span className="printer-card-state">{eligible ? (mismatch ? 'Check filament' : 'Idle') : printer.is_held ? 'Held' : printer.status}</span>
                  <span className="printer-card-filament">{[printer.loaded_material, printer.loaded_color].filter(Boolean).join(' · ') || 'Filament not recorded'}</span>
                </button>
              );
            })}
          </div>
        </section>

        {error && <div className="send-error" role="alert">{error}</div>}

        {phase === 'setup' || phase === 'preflighting' ? (
          <div className="send-launchbar">
            <div><strong>{action === 'upload_print' ? 'Guarded upload & print' : 'Verified upload only'}</strong><span>{selected.size} target{selected.size === 1 ? '' : 's'} · {model ? modelLabel(model) : 'choose model'}</span></div>
            <button className="send-button primary" disabled={phase !== 'setup'} type="submit">
              {phase === 'preflighting' ? 'Checking fleet…' : 'Preflight selected printers'}
            </button>
          </div>
        ) : null}
      </form>

      {session && phase !== 'setup' && (
        <section className="send-review-panel">
          <div className="send-section-heading">
            <span>03</span>
            <div>
              <h2>{phase === 'complete' ? 'Fleet Send complete' : phase === 'running' ? 'Dispatch in progress' : 'Confirm this one-shot send'}</h2>
              <p><code>{session.filename}</code> · {modelLabel(session.model)} · {session.targets.length} targets</p>
            </div>
          </div>

          <div className="send-progress-list">
            {session.targets.map((target) => <ProgressRow key={target.printerId} target={target} progress={session.progress?.[target.printerId]} />)}
          </div>

          <div className="send-review-actions">
            {phase === 'review' && <>
              <button type="button" className="send-button quiet" onClick={cancelSession}>Cancel</button>
              <button type="button" className="send-button primary danger-aware" onClick={executeSession}>
                {session.action === 'upload_print' ? 'Confirm upload & print' : 'Confirm upload only'}
              </button>
            </>}
            {phase === 'running' && <span className="working-message"><i />Keep this page open while files are transferred.</span>}
            {phase === 'complete' && <button type="button" className="send-button primary" onClick={cancelSession}>Send another file</button>}
          </div>
        </section>
      )}

      {showConflicts && session && (
        <ConflictHud
          session={session}
          decisions={decisions}
          setDecision={(printerId, decision) => setDecisions((current) => ({ ...current, [printerId]: decision }))}
          onContinue={() => setShowConflicts(false)}
          onCancel={cancelSession}
        />
      )}
    </div>
  );
}
