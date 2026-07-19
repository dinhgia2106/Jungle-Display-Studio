const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jungle', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  getSystem: () => ipcRenderer.invoke('system:get'),
  getAgents: () => ipcRenderer.invoke('agents:get'),
  refreshAgents: () => ipcRenderer.invoke('agents:refresh'),
  configureClaudeBridge: () => ipcRenderer.invoke('agents:configure-claude'),
  pickMedia: (kind) => ipcRenderer.invoke('media:pick', kind),
  pickVideo: () => ipcRenderer.invoke('media:pick', 'video'),
  scanDevices: () => ipcRenderer.invoke('device:scan'),
  getDeviceState: () => ipcRenderer.invoke('device:state'),
  connectDevice: (target) => ipcRenderer.invoke('device:connect', target),
  disconnectDevice: () => ipcRenderer.invoke('device:disconnect'),
  openPreview: () => ipcRenderer.invoke('preview:open'),
  onSettings: (callback) => ipcRenderer.on('settings:updated', (_, value) => callback(value)),
  onDevice: (callback) => ipcRenderer.on('device:updated', (_, value) => callback(value)),
  onAgents: (callback) => ipcRenderer.on('agents:updated', (_, value) => callback(value))
});
