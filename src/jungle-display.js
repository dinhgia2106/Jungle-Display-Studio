const { SerialPort } = require('serialport');
const deviceProfiles = require('./device-profiles.json');

const JUNGLE_SERIAL_IDS = new Set(deviceProfiles.devices.map(({ vendorId, productId }) =>
  String(vendorId).toUpperCase() + ':' + String(productId).toUpperCase()));
const BAUD_RATE = Number(deviceProfiles.baudRate) || 2_000_000;

function normalizedId(port) {
  return `${String(port.vendorId || '').toUpperCase()}:${String(port.productId || '').toUpperCase()}`;
}

function isJungleDisplayPort(port) {
  return JUNGLE_SERIAL_IDS.has(normalizedId(port));
}

function buildCommand(command, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const packet = Buffer.alloc(7 + body.length);
  packet[0] = 0x55;
  packet[1] = 0xaa;
  packet.writeUInt16LE(packet.length, 2);
  packet[4] = command;
  body.copy(packet, 5);
  let checksum = 0;
  for (let index = 0; index < packet.length - 2; index += 1) checksum = (checksum + packet[index]) & 0xffff;
  packet.writeUInt16LE(checksum, packet.length - 2);
  return packet;
}

function friendlyPort(port) {
  const vendorId = String(port.vendorId || '').toUpperCase();
  const productId = String(port.productId || '').toUpperCase();
  const definition = deviceProfiles.devices.find((device) =>
    String(device.vendorId).toUpperCase() === vendorId &&
    String(device.productId).toUpperCase() === productId);
  const fingerprint = (port.serialNumber || port.path || 'device').replace(/[^a-z0-9_.:-]/gi, '-');
  return {
    id: 'jungle-' + vendorId + '-' + productId + '-' + fingerprint,
    path: port.path,
    vendorId,
    productId,
    serialNumber: port.serialNumber || '',
    manufacturer: port.manufacturer || '',
    label: (definition?.description || 'Jungle Display') + ' - ' + port.path,
    defaultProfile: definition?.defaultProfile || null
  };
}

class JungleDisplayDriver {
  constructor({ captureFrame, onState }) {
    this.captureFrame = captureFrame;
    this.onState = onState;
    this.port = null;
    this.running = false;
    this.writeChain = Promise.resolve();
    this.lastKeepAlive = 0;
    this.frames = 0;
    this.bytes = 0;
    this.startedAt = 0;
    this.lastReport = 0;
    this._state = { status: 'disconnected', portPath: null, messageKey: 'device.disconnected', fps: 0, frameBytes: 0 };
  }

  get state() { return this._state; }
  get isConnected() { return Boolean(this.port?.isOpen); }

  update(patch) {
    this._state = { ...this._state, ...patch };
    this.onState?.(this._state);
    return this._state;
  }

  async scan() {
    const ports = await SerialPort.list();
    return ports.filter(isJungleDisplayPort).map(friendlyPort);
  }

  async connect(requestedPath = 'auto', brightness = 100) {
    if (this.isConnected) return this.state;
    this.update({ status: 'connecting', messageKey: 'device.connecting', message: '', portPath: null });
    try {
      const devices = await this.scan();
      const target = requestedPath === 'auto' || !requestedPath
        ? devices[0]
        : devices.find((device) => device.path.toLowerCase() === String(requestedPath).toLowerCase());
      if (!target) {
        const error = new Error('No compatible Jungle USB Serial display was found.');
        error.code = 'DEVICE_NOT_FOUND';
        throw error;
      }

      this.port = new SerialPort({ path: target.path, baudRate: BAUD_RATE, autoOpen: false });
      this.port.on('error', (error) => this.fail(error));
      this.port.on('close', () => {
        this.running = false;
        if (this._state.status !== 'error') this.update({ status: 'disconnected', messageKey: 'device.disconnected', message: '', fps: 0 });
      });
      await new Promise((resolve, reject) => this.port.open((error) => error ? reject(error) : resolve()));

      this.running = true;
      this.frames = 0;
      this.bytes = 0;
      this.startedAt = Date.now();
      this.lastReport = 0;
      await this.sendCommand(0x06);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await this.setBrightness(brightness);
      await this.sendCommand(0x11);
      this.lastKeepAlive = Date.now();
      this.update({ status: 'streaming', portPath: target.path, messageKey: 'device.streaming', message: '', fps: 0 });
      this.streamLoop();
      return this.state;
    } catch (error) {
      const busy = /access|denied|cannot open|opening/i.test(error.message || '');
      const messageKey = error.code === 'DEVICE_NOT_FOUND' ? 'device.notFound' : busy ? 'device.busy' : 'device.error';
      await this.closePort();
      this.update({ status: 'error', messageKey, message: messageKey === 'device.error' ? error.message : '', fps: 0 });
      return this.state;
    }
  }

  async sendCommand(command, payload) {
    return this.enqueue(buildCommand(command, payload));
  }

  async setBrightness(value) {
    if (!this.isConnected) return;
    const brightness = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    await this.sendCommand(0x03, Buffer.from([brightness]));
  }

  enqueue(buffer) {
    const port = this.port;
    this.writeChain = this.writeChain.then(() => new Promise((resolve, reject) => {
      if (!port?.isOpen) return reject(new Error('Jungle display is not connected.'));
      port.write(buffer, (writeError) => {
        if (writeError) return reject(writeError);
        port.drain((drainError) => drainError ? reject(drainError) : resolve());
      });
    }));
    return this.writeChain;
  }

  async streamLoop() {
    while (this.running && this.isConnected) {
      try {
        if (Date.now() - this.lastKeepAlive >= 1400) {
          await this.sendCommand(0x11);
          this.lastKeepAlive = Date.now();
        }
        const frame = await this.captureFrame();
        if (!this.running || !this.isConnected) break;
        await this.enqueue(frame);
        this.frames += 1;
        this.bytes += frame.length;
        if (Date.now() - this.lastReport >= 500) {
          const elapsed = Math.max(1, (Date.now() - this.startedAt) / 1000);
          this.lastReport = Date.now();
          this.update({
            status: 'streaming', messageKey: 'device.streaming', message: '',
            fps: Math.round(this.frames / elapsed * 10) / 10,
            frameBytes: frame.length, totalBytes: this.bytes
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 16));
      } catch (error) {
        if (this.running) this.fail(error);
        break;
      }
    }
  }

  fail(error) {
    if (!this.running && this._state.status === 'disconnected') return;
    this.running = false;
    this.update({ status: 'error', messageKey: 'device.error', message: error.message || '', fps: 0 });
    this.closePort();
  }

  async closePort() {
    const port = this.port;
    this.running = false;
    this.port = null;
    this.writeChain = Promise.resolve();
    if (!port?.isOpen) return;
    await new Promise((resolve) => port.close(() => resolve()));
  }

  async disconnect() {
    this.running = false;
    await this.closePort();
    return this.update({ status: 'disconnected', portPath: null, messageKey: 'device.disconnected', message: '', fps: 0, frameBytes: 0 });
  }
}

module.exports = { JungleDisplayDriver, BAUD_RATE, buildCommand, isJungleDisplayPort };