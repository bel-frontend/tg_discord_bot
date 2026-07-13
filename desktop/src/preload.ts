import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('composerDesktop', {
    agentStatus: () => ipcRenderer.invoke('desktop:agent-status'),
    pairAgent: (code: string) => ipcRenderer.invoke('desktop:agent-pair', code),
    threadsStatus: () => ipcRenderer.invoke('desktop:threads-status'),
    connectThreads: () => ipcRenderer.invoke('desktop:threads-connect'),
    disconnectThreads: () => ipcRenderer.invoke('desktop:threads-disconnect'),
    xStatus: () => ipcRenderer.invoke('desktop:x-status'),
    connectX: () => ipcRenderer.invoke('desktop:x-connect'),
    disconnectX: () => ipcRenderer.invoke('desktop:x-disconnect'),
});
