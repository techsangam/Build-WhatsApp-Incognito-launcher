const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherApi', {
  getState: () => ipcRenderer.invoke('launcher:get-state'),
  openWhatsApp: (chromePath) => ipcRenderer.invoke('launcher:open', chromePath),
  closeSession: () => ipcRenderer.invoke('launcher:close'),
  onStateChange: (callback) => {
    const wrapped = (_event, state) => callback(state);
    ipcRenderer.on('launcher:state', wrapped);

    return () => {
      ipcRenderer.removeListener('launcher:state', wrapped);
    };
  }
});
