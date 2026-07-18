// Driver registry — maps printer.type → driver module.
// Each driver implements: getStatus, uploadAndPrint, cancelJob, checkIfPrinting.
// Add a new entry here when a new printer brand is supported.
//
// Drivers are loaded lazily (on first getDriver call for that type) so that
// optional native dependencies (e.g. sdcp → mqtt-server) are only required
// when a printer of that brand is actually present.

const LOADERS = {
  'prusa':            () => require('./prusa'),
  'elegoo-centauri':  () => require('./elegoo-centauri'),
  'elegoo-centauri2': () => require('./elegoo-centauri2'),
  'bambu':            () => require('./bambu'),
  'klipper':          () => require('./klipper'),
  'octoprint':        () => require('./octoprint'),
};

function getDriver(type) {
  const load = LOADERS[type];
  if (!load) throw new Error(`No driver registered for printer type: "${type}"`);
  return load();
}

const FLEET_SEND_METHODS = ['listFiles', 'uploadFile', 'startFile', 'deleteFile'];

function getFleetSendCapabilities(type) {
  const driver = getDriver(type);
  const missing = FLEET_SEND_METHODS.filter((method) => typeof driver[method] !== 'function');
  return {
    supported: missing.length === 0,
    acceptedExtensions: Array.isArray(driver.acceptedExtensions)
      ? [...driver.acceptedExtensions]
      : [],
    missing,
  };
}

module.exports = { getDriver, getFleetSendCapabilities };
