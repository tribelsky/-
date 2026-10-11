const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { scanProject, createSandboxCopy } = require('./src/core/scanner');

function createWindow(){
  const win=new BrowserWindow({width:1440,height:920,minWidth:1080,minHeight:700,backgroundColor:'#071019',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.removeMenu();
  win.loadFile(path.join(__dirname,'src','index.html'));
}

app.whenReady().then(()=>{createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});

ipcMain.handle('select-folder',async()=>{
  const r=await dialog.showOpenDialog({properties:['openDirectory'],title:'בחר אפליקציה לבדיקה'});
  return r.canceled?null:r.filePaths[0];
});
ipcMain.handle('scan-project',async(_e,root)=>scanProject(root));
ipcMain.handle('create-sandbox',async(_e,root)=>createSandboxCopy(root));
ipcMain.handle('export-report',async(_e,report)=>{
  const r=await dialog.showSaveDialog({title:'שמור Evidence Report',defaultPath:`transformix-evidence-${Date.now()}.json`,filters:[{name:'JSON',extensions:['json']}]});
  if(r.canceled||!r.filePath)return null; fs.writeFileSync(r.filePath,JSON.stringify(report,null,2),'utf8'); return r.filePath;
});