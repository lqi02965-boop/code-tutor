const { contextBridge, ipcRenderer } = require('electron');

/* 端口与任务名：preload 在 sandbox 模式下 process.argv 不含自定义参数，
 * 必须经 IPC 从主进程拿（ct:config）；argv 解析只作兜底。 */
let PORT = 19290;
let TASK = 'default';
let BASE = 'http://127.0.0.1:' + PORT;

try {
  const hit = process.argv.find((a) => a && a.startsWith && a.startsWith('--port='));
  if (hit) PORT = Number(hit.split('=')[1]);
  const t = process.argv.find((a) => a && a.startsWith && a.startsWith('--task='));
  if (t) TASK = t.split('=').slice(1).join('=');
  BASE = 'http://127.0.0.1:' + PORT;
} catch { /* sandboxed argv */ }

/* IPC 修正（主进程是唯一可信来源） */
ipcRenderer.invoke('ct:config').then((cfg) => {
  if (cfg && cfg.port) { PORT = cfg.port; BASE = 'http://127.0.0.1:' + PORT; }
  if (cfg && cfg.task) TASK = cfg.task;
}).catch(() => {});

contextBridge.exposeInMainWorld('ct', {
  getMode: () => ipcRenderer.invoke('ct:getMode'),
  collapse: () => ipcRenderer.send('ct:collapse'),
  expand: () => ipcRenderer.send('ct:expand'),
  hide: () => ipcRenderer.send('ct:hide'),
  quit: () => ipcRenderer.send('ct:quit'),
  drag: (dx, dy) => ipcRenderer.send('ct:drag', dx, dy),
  get task() { return TASK; },           // getter：IPC 异步修正后渲染层读到的也是新值
  get port() { return PORT; },
  // Chat: renderer -> local control server (per-task port) -> DSH bridge (19387) -> ctx.llm
  chat: (text, history) => fetch(BASE + '/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, history }),
  }).then((r) => r.json()).then((j) => {
    if (j.ok) return String(j.text || '');
    throw new Error(String(j.error || 'chat failed'));
  }),
  // Local file & build capabilities (agent's hands)
  readFile: (path) => fetch(BASE + '/file/read?path=' + encodeURIComponent(path))
    .then((r) => r.json()).then((j) => {
      if (j.ok) return String(j.content || '');
      throw new Error(String(j.error || 'read failed'));
    }),
  build: () => fetch(BASE + '/build', { method: 'POST' })
    .then((r) => r.json()).then((j) => {
      if (j.ok) return { exitCode: j.exitCode, log: String(j.log || '') };
      throw new Error(String(j.error || 'build failed'));
    }),
  // Memory vault (Obsidian): save rounds / list & read history (per task / cross-task)
  memSave: (text, who) => fetch(BASE + '/memory/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, who }),
  }).then((r) => r.json()).catch(() => {}),
  memList: (task) => fetch(BASE + '/memory/list' + (task ? '?task=' + encodeURIComponent(task) : ''))
    .then((r) => r.json()).then((j) => {
      if (j.ok) return { files: j.files || [], current: j.current };
      throw new Error(String(j.error || 'list failed'));
    }),
  memRead: (name, task) => fetch(BASE + '/memory/read?name=' + encodeURIComponent(name) + (task ? '&task=' + encodeURIComponent(task) : ''))
    .then((r) => r.json()).then((j) => {
      if (j.ok) return String(j.content || '');
      throw new Error(String(j.error || 'read failed'));
    }),
  tasks: () => fetch(BASE + '/tasks')
    .then((r) => r.json()).then((j) => {
      if (j.ok) return { tasks: j.tasks || [], current: j.current };
      throw new Error(String(j.error || 'tasks failed'));
    }),
  // 硬件档案（per task，存 任务-<task>/hw_profile.json）
  hwGet: () => fetch(BASE + '/hw/get')
    .then((r) => r.json()).then((j) => {
      if (j.ok) return j.hw || {};
      throw new Error(String(j.error || 'hw get failed'));
    }),
  hwSave: (profile) => fetch(BASE + '/hw/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  }).then((r) => r.json()).then((j) => {
    if (j.ok) return true;
    throw new Error(String(j.error || 'hw save failed'));
  }),
  hwPresets: () => fetch(BASE + '/hw/presets')
    .then((r) => r.json()).then((j) => (j.ok ? j.presets || [] : [])),
  // 跨任务跳转：拉起/聚焦目标任务窗口并预载对话上下文
  launch: (task, preload) => fetch(BASE + '/launch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task, preload }),
  }).then((r) => r.json()),
  resumeTake: () => fetch(BASE + '/resume/take')
    .then((r) => r.json()).then((j) => j.resume || null).catch(() => null),
  onMode: (cb) => ipcRenderer.on('ct:mode', (_e, m) => cb(m)),
  onPush: (cb) => ipcRenderer.on('ct:push', (_e, text, who) => cb(text, who)),
});
