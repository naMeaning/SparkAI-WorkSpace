"use strict";
const { app, BrowserWindow } = require("electron");
const { readFileSync, mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const runDir = path.join(root, ".diagnostics", `region-mask-owner-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(runDir, { recursive: true });
app.setPath("userData", path.join(runDir, "electron-profile"));
const source = ts.transpileModule(readFileSync(path.join(root, "src/region-mask-editor.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
let window;
app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 600, height: 500, show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await window.loadURL("data:text/html,<html><body><h3>Region mask owner verification</h3></body></html>");
  const report = await window.webContents.executeJavaScript(`(async () => {
    const { RegionMaskEditor, maskCanvasPoint, zoomMaskView, maskDraftKey, readMaskDraft } = (() => { const exports = {}; ${source}\n return exports; })();
    const checks = [], expect = (value, message) => { if (!value) throw new Error(message); }, check = async (name, action) => { await action(); checks.push(name); };
    const target = {assetId:'asset-source',occurrenceId:'occ-source',contentHash:'a'.repeat(64)};
    const editor = new RegionMaskEditor(target,64,64);
    const pixels = async value => { const image=new Image();image.src=value.dataUrl;await image.decode();const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const context=canvas.getContext('2d');context.drawImage(image,0,0);return context.getImageData(0,0,64,64).data; };
    const alpha = (data,x,y) => data[(y*64+x)*4+3];
    await check('source coordinates under zoom and pan', () => {
      const a=maskCanvasPoint(132,82,{left:100,top:50,width:64,height:64},64,64);
      const b=maskCanvasPoint(94,84,{left:30,top:20,width:128,height:128},64,64);
      expect(a.x===32 && a.y===32 && b.x===32 && b.y===32,'zoom/pan must map to the same original pixel');
      const view={zoom:1,panX:11,panY:-8}, next=zoomMaskView(view,2,40,20);
      expect((40-view.panX)/view.zoom===(40-next.panX)/next.zoom,'zoom anchor x drift');
      expect((20-view.panY)/view.zoom===(20-next.panY)/next.zoom,'zoom anchor y drift');
    });
    editor.begin('modify-stroke','modify','brush',24,{x:32,y:32});editor.append({x:44,y:32});
    editor.begin('protect-stroke','preserve','brush',8,{x:32,y:32});
    editor.begin('annotation-stroke','annotation','brush',10,{x:8,y:8});
    await check('modify preserve annotation have distinct pixel ownership',async()=>{
      const mask=await pixels(editor.exportMask('edit','logo'));
      expect(alpha(mask,32,32)===255,'preserve must win over modify');
      expect(alpha(mask,42,32)===0,'modify area must be editable');
      expect(alpha(mask,8,8)===255,'annotation must not become a modify mask');
      const output=editor.exportMask('edit','logo');expect(output.regions.length===1&&output.regions[0].role==='annotation'&&output.regions[0].regionId==='annotation-annotation-stroke','annotation identity/role lost');
    });
    await check('eraser and history preserve exact mask bytes',async()=>{
      const before=editor.exportMask('edit').dataUrl;
      editor.begin('erase-stroke','modify','eraser',10,{x:44,y:32});
      const erased=editor.exportMask('edit').dataUrl;expect(alpha(await pixels({dataUrl:erased}),44,32)===255,'eraser did not clear modify layer');
      editor.undo();expect(editor.exportMask('edit').dataUrl===before,'undo did not restore original pixels');
      editor.redo();expect(editor.exportMask('edit').dataUrl===erased,'redo changed stroke pixels');
      expect(editor.snapshot().actions[0].id==='modify-stroke','history changed identity');
    });
    await check('invert is reversible and retains protection',async()=>{
      const before=editor.exportMask('edit').dataUrl;editor.invert('invert-modify','modify');const mask=await pixels(editor.exportMask('edit'));
      expect(alpha(mask,0,0)===0&&alpha(mask,32,32)===255,'invert changed protection priority');editor.undo();expect(editor.exportMask('edit').dataUrl===before,'undo inversion not exact');
    });
    await check('new edit after undo discards redo branch',()=>{editor.begin('new-annotation','annotation','brush',2,{x:8,y:8});expect(!editor.canRedo,'redo branch survived a new edit');});
    await check('background protection mask and cutout mask remain independent',async()=>{
      const protect=await pixels(editor.exportMask('protect'));expect(alpha(protect,32,32)===255&&alpha(protect,42,32)===0,'background protection mask used modify paint');
      const cutout=await pixels(editor.exportMask('keep'));expect(alpha(cutout,32,32)===255&&alpha(cutout,8,8)===0,'cutout included annotations');
    });
    await check('clear can be undone',()=>{const before=editor.exportMask('edit').dataUrl;editor.clear('clear-all');expect(editor.exportMask('edit').paintedPixels===0,'clear left selected pixels');editor.undo();expect(editor.exportMask('edit').dataUrl===before,'clear undo lost pixels');});
    await check('vector draft restores exact masks and annotation identities',()=>{
      const key=maskDraftKey('project',target,'redraw'), value={version:1,document:editor.snapshot(),prompt:'retain logo',view:{zoom:2,panX:12,panY:-5},savedAt:Date.now()};
      const storage={getItem:()=>JSON.stringify(value)}, saved=readMaskDraft(storage,key,target,64,64), restored=new RegionMaskEditor(target,64,64,saved.document);
      expect(restored.exportMask('edit').dataUrl===editor.exportMask('edit').dataUrl,'restored draft changed pixels');
      expect(restored.exportMask('edit').regions[0].regionId===editor.exportMask('edit').regions[0].regionId,'restored annotation identity drift');
      expect(key!==maskDraftKey('other-project',target,'redraw')&&key!==maskDraftKey('project',{...target,contentHash:'b'.repeat(64)},'redraw'),'draft key aliases project/source revisions');
      expect(!JSON.stringify(value).includes('base64')&&!JSON.stringify(value).includes('path'),'draft must store vectors, not image bytes or paths');
    });
    await check('source revision and dimensions reject stale drafts',()=>{
      for(const [other,w,h] of [[{...target,contentHash:'b'.repeat(64)},64,64],[target,32,64]]) {let failed=false;try{new RegionMaskEditor(other,w,h,editor.snapshot())}catch{failed=true}expect(failed,'stale source draft accepted');}
      const invalid=editor.snapshot();invalid.actions[0].points[0].x=NaN;let failed=false;try{new RegionMaskEditor(target,64,64,invalid)}catch{failed=true}expect(failed,'corrupt vector draft accepted');
    });
    await check('rendered overlays keep distinct roles',()=>{
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;canvas.style='width:384px;height:384px;image-rendering:pixelated;background:#ddd';document.body.append(canvas);editor.render(canvas);
      const data=canvas.getContext('2d').getImageData(0,0,64,64).data, center=(32*64+32)*4, corner=(8*64+8)*4;
      expect(data[center+1]>data[center]&&data[corner+2]>data[corner],'overlay role colors were flattened');
    });
    return {ok:true,checks,realModelRequests:0,ownerCanvasVerified:true};
  })().catch(error => ({ok:false,error:error.message,stack:error.stack}))`);
  if (!report.ok) throw new Error(`${report.error}\n${report.stack}`);
  writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(runDir, "owner-canvas.png"), (await window.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({ ...report, reportPath: path.join(runDir, "report.json") }));
  window.destroy(); app.exit(0);
}).catch(error => { writeFileSync(path.join(runDir, "report.json"), JSON.stringify({ ok: false, error: error.message }, null, 2)); console.error(error); window?.destroy(); app.exit(1); });
