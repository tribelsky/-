const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('transformix',{
  selectFolder:()=>ipcRenderer.invoke('select-folder'),
  scanProject:(root)=>ipcRenderer.invoke('scan-project',root),
  createSandbox:(root)=>ipcRenderer.invoke('create-sandbox',root),
  exportReport:(report)=>ipcRenderer.invoke('export-report',report)
});