const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jungle', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  getSystem: () => ipcRenderer.invoke('system:get'),
  pickVideo: () => ipcRenderer.invoke('media:pick'),
  scanDevices: () => ipcRenderer.invoke('device:scan'),
  getDeviceState: () => ipcRenderer.invoke('device:state'),
  connectDevice: (path) => ipcRenderer.invoke('device:connect', path),
  disconnectDevice: () => ipcRenderer.invoke('device:disconnect'),
  openPreview: () => ipcRenderer.invoke('preview:open'),
  onSettings: (callback) => ipcRenderer.on('settings:updated', (_, value) => callback(value)),
  onDevice: (callback) => ipcRenderer.on('device:updated', (_, value) => callback(value))
});