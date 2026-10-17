/**
 * code-tutor floating window main process.
 * Runs independently of DSH (DeepSeek Harness); minimizing/closing DSH does not affect this window.
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, screen } = require('electron');
const path = require('path');

let win = null;
let tray = null;
let collapsed = false;

const WIN_W = 380, WIN_H = 620;
const BALL = 56;
const MIN_FULL_W = 280, MIN_FULL_H = 360;

function createWindow() {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: sw - WIN_W - 24,
    y: 120,
    frame: false,
    resizable: true,          // 允许拖边缘缩放（小球模式在 enforceSize 里单独锁死）
    minWidth: MIN_FULL_W,
    minHeight: MIN_FULL_H,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setTitle('Code Tutor · ' + TASK);
  win.loadFile('index.html');

  win.on('closed', () => { win = null; });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'tray.ico'));
  tray.setToolTip('Code Tutor · ' + TASK);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show/Hide', click: () => toggleVisible() },
    { label: 'Expand/Collapse', click: () => toggleCollapse() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', () => toggleVisible());
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide(); else win.show();
}

let fullSize = { width: WIN_W, height: WIN_H };  // 展开模式记住用户调整后的尺寸

function toggleCollapse() {
  if (!win) return;
  collapsed = !collapsed;
  const [x, y] = win.getPosition();
  if (collapsed) {
    // 收起前记住当前展开尺寸
    const [w, h] = win.getSize();
    fullSize = { width: w, height: h };
    win.setMinimumSize(BALL, BALL);
    win.setBounds({ x: x + w - BALL, y, width: BALL, height: BALL });
    win.setResizable(false);   // 小球不许拖边缘
    win.webContents.send('ct:mode', 'ball');
  } else {
    win.setResizable(true);
    win.setMinimumSize(MIN_FULL_W, MIN_FULL_H);
    win.setBounds({ x: Math.max(0, x - (fullSize.width - BALL)), y, width: fullSize.width, height: fullSize.height });
    win.webContents.send('ct:mode', 'full');
  }
}

/* 只锁小球尺寸：防止小球被意外改变；展开尺寸由用户自由调整，不再强制回弹 */
function enforceSize() {
  if (!win || !collapsed) return;
  const [w, h] = win.getSize();
  if (w !== BALL || h !== BALL) {
    const [x, y] = win.getPosition();
    win.setBounds({ x, y, width: BALL, height: BALL });
  }
}

ipcMain.handle('ct:getMode', () => (collapsed ? 'ball' : 'full'));

ipcMain.on('ct:collapse', () => { if (!collapsed) toggleCollapse(); });
ipcMain.on('ct:expand', () => { if (collapsed) toggleCollapse(); });
ipcMain.on('ct:hide', () => win && win.hide());
ipcMain.on('ct:quit', () => app.quit());

ipcMain.on('ct:drag', (_e, dx, dy) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
});

function clampIntoScreen() {
  if (!win) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const [x, y] = win.getPosition();
  const [w, h] = win.getSize();
  const nx = Math.min(Math.max(x, wa.x - w + BALL), wa.x + wa.width - BALL);
  const ny = Math.min(Math.max(y, wa.y), wa.y + wa.height - BALL);
  if (nx !== x || ny !== y) win.setPosition(nx, ny);
}

/* ---------- Task & multi-instance support ----------
 * 启动参数：--task=iic --port=19291
 * 每个任务一个窗口实例；对话记录写到各自子库 D:\knowledge\CodeTutor记忆\任务-<task>\对话记录\
 * 父库根下的 00-索引.md 自动登记所有任务的子库位置与摘要。
 */
const CLI_ARGS = process.argv.slice(1).filter((a) => a.startsWith('--'));
function argValue(name, fallback) {
  const hit = CLI_ARGS.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}
const TASK = String(argValue('task', 'default')).replace(/[\\/:*?"<>|]/g, '_') || 'default';
const CTRL_PORT = Number(argValue('port', 19290)); // 每个实例一个端口；DSH Web GUI 是 19387
const VAULT_ROOT = 'D:\\knowledge\\CodeTutor记忆';
const TASK_DIR = path.join(VAULT_ROOT, '任务-' + TASK);
const MEM_DIR = path.join(TASK_DIR, '对话记录');
const INDEX_FILE = path.join(VAULT_ROOT, '00-索引.md');

/** 把当前任务登记进父库索引（存在则更新"最近活跃"行，不存在则新增小节） */
async function registerTask() {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${now.toTimeString().slice(0, 5)}`;
  await fsp.mkdir(VAULT_ROOT, { recursive: true });
  let md = '';
  try { md = await fsp.readFile(INDEX_FILE, 'utf8'); } catch {
    md = '# Code Tutor 记忆库 · 任务索引\n\n> 由悬浮窗自动维护：每个任务一个子库（任务-<名称>/对话记录/），本文件记录位置与内容摘要。\n> 在悬浮窗【历史】面板可跨任务查看；从任一任务的某轮对话"从此继续"。\n\n---\n\n';
  }
  const rowRe = new RegExp(`^\\| ${TASK} \\|`);
  const newRow = `| ${TASK} | 任务-${TASK}/对话记录/ | ${stamp} | ${TASK} 相关的全部对话，按天分文件 |`;
  if (rowRe.test(md)) {
    md = md.split('\n').map((l) => (rowRe.test(l) ? newRow : l)).join('\n');
  } else {
    if (!md.includes('| 任务 | 子库位置 |')) {
      md += '\n## 任务列表\n\n| 任务 | 子库位置 | 最近活跃 | 内容说明 |\n|---|---|---|---|\n';
    }
    md += newRow + '\n';
  }
  await fsp.writeFile(INDEX_FILE, md, 'utf8');
}

/** GET /tasks -> all task names */
async function taskList() {
  try {
    const entries = await fsp.readdir(VAULT_ROOT, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && e.name.startsWith('任务-')).map((e) => e.name.slice(3));
  } catch { return []; }
}

/** POST /launch {task, preload} -> spawn (or focus) the window of that task.
 * preload: 可选 [{who, text}]，新窗口/已有窗口载入后作为初始上下文直接续聊。
 * 实现：写一份"待载入上下文"到该任务子库的 .resume.json，目标实例启动/轮询时取走并应用到会话。 */
async function launchTask(task, preload) {
  const clean = String(task || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!clean) throw new Error('任务名不能为空');
  // 写续接上下文文件（无论目标是否已在跑，实例就绪后都会取）
  if (Array.isArray(preload) && preload.length) {
    const dir = path.join(VAULT_ROOT, '任务-' + clean);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, '.resume.json'), JSON.stringify({ rounds: preload, at: Date.now() }), 'utf8');
  }
  const running = await taskRunningSet();
  if (running.has(clean)) return { ok: true, already: true, task: clean };
  const selfDir = __dirname;
  const exe = path.join(selfDir, 'electron.exe');
  // 找空闲端口
  const net = require('net');
  const freePort = await new Promise((resolve) => {
    // 用"尝试连接"探测占用：连得上=被占（跳过），连不上=空闲（选它）。避免自建 listen server 关闭竞争。
    const tryPort = (p) => {
      if (p > 19299) return resolve(19291); // 兜底
      const s = net.connect(p, '127.0.0.1');
      s.once('connect', () => { s.destroy(); tryPort(p + 1); });   // 被占，试下一个
      s.once('error', () => resolve(p));                            // 空闲
    };
    tryPort(19291);
  });
  // 直接 spawn electron（数组参数 node 会正确引用），关键：显式清 ELECTRON_RUN_AS_NODE
  // （宿主 DSH 环境带着 =1，继承后新实例变纯 node 模式秒退；bat 壳方案已验证冗余）
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnProc(exe, [selfDir, '--task=' + clean, '--port=' + freePort], {
    cwd: selfDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env,
  });
  child.on('error', (e) => { try { fsp.appendFile(path.join(VAULT_ROOT, 'launch-debug.log'), new Date().toISOString() + ' spawn error: ' + e.message + '\n').catch(() => {}); } catch {} });
  child.on('exit', (code) => { try { fsp.appendFile(path.join(VAULT_ROOT, 'launch-debug.log'), new Date().toISOString() + ' child exit: ' + code + '\n').catch(() => {}); } catch {} });
  child.unref();
  return { ok: true, task: clean, port: freePort };
}

/** GET /resume/take -> 取走本任务的待载入上下文（原子：取走即删） */
async function resumeTake() {
  const f = path.join(VAULT_ROOT, '任务-' + TASK, '.resume.json');
  try {
    const raw = await fsp.readFile(f, 'utf8');
    await fsp.rm(f, { force: true });
    return JSON.parse(raw);
  } catch { return null; }
}

/* ---------- 自动任务分类：判断一轮对话属于哪个任务子库，属他库则搬家 ---------- */

/** 从父库索引收集已知任务名 */
async function knownTasks() {
  const tasks = await taskList();
  if (!tasks.includes(TASK)) tasks.push(TASK);
  return tasks.filter((t) => t !== 'default'); // default 是兜底，不参与匹配
}

/** 把已写入本轮对话的今天 md 里的对应小节搬到目标任务子库（按时间戳定位） */
async function moveToTask(entry, targetTask) {
  const clean = String(targetTask).replace(/[\\/:*?"<>|]/g, '_');
  if (!clean || clean === TASK) return { moved: false };
  const srcFile = memFileFor(new Date());
  let md = '';
  try { md = await fsp.readFile(srcFile, 'utf8'); } catch { return { moved: false }; }
  const ts = new Date().toTimeString().slice(0, 5);
  const headRe = new RegExp(`### ${ts} · ${entry.who === 'user' ? '我' : 'Code Tutor'}\\s*\\n`);
  const idx = md.search(headRe);
  if (idx < 0) return { moved: false };
  // 小节结束 = 下一个 "### " 或文末
  const next = md.indexOf('\n### ', idx + 5);
  const section = next < 0 ? md.slice(idx) : md.slice(idx, next + 1);
  // 目标子库追加
  const dstDir = path.join(VAULT_ROOT, '任务-' + clean, '对话记录');
  await fsp.mkdir(dstDir, { recursive: true });
  const dstFile = memFileFor(new Date()).replace(MEM_DIR, dstDir);
  let head = '';
  try { await fsp.access(dstFile); } catch {
    head = `# 对话记录 ${path.basename(dstFile, '.md')}\n\n> 由 Code Tutor 悬浮窗自动写入，每轮对话追加一段。\n\n---\n\n`;
  }
  await fsp.appendFile(dstFile, head + section, 'utf8');
  // 从源文件删除该小节
  await fsp.writeFile(srcFile, (next < 0 ? md.slice(0, idx) : md.slice(0, idx) + md.slice(next + 1)), 'utf8');
  await registerTask(); // 索引里若无该任务则补登记
  return { moved: true, task: clean };
}

/** 询问桥接 LLM：这轮对话属于哪个已知任务？（规则先行，LLM 兜底） */
const CLASSIFY_PROVIDER = 'workbuddy';
const CLASSIFY_MODEL = 'deepseek-v4.1-flash';
async function classifyRound(text) {
  const tasks = await knownTasks();
  if (tasks.length === 0) return TASK;
  // 1. 规则快筛：文本明确提到任务名
  const low = String(text).toLowerCase();
  const hit = tasks.find((t) => low.includes(t.toLowerCase()));
  if (hit) return hit;
  // 2. LLM 判定（悬浮窗进程拿不到宿主的 @deepseek-ai/dsh-llm，走 DSH 桥接的极简分类调用）
  try {
    const out = await new Promise((resolve, reject) => {
      const body = JSON.stringify({
        text: String(text).slice(0, 500),
        classify: true,
        candidates: tasks,
      });
      const req = http.request(DSH_ORIGIN + '/code-tutor/classify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        timeout: 25000,
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.ok) resolve(String(j.task || 'OTHER'));
            else reject(new Error(String(j.error || 'HTTP ' + res.statusCode)));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('classify 超时')));
      req.end(body);
    });
    const m = tasks.find((t) => out.includes(t));
    return m || TASK;
  } catch { return TASK; }
}

/** 当前已在运行的任务集合（探测各实例 /tasks） */
function taskRunningSet() {
  return new Promise(async (resolve) => {
    const set = new Set([TASK]); // 本实例肯定在跑
    const tasks = await taskList();
    let pending = tasks.length;
    if (pending === 0) return resolve(set);
    for (const t of tasks) {
      if (t === TASK) { pending--; continue; }
      // 从索引文件拿不到端口，逐个探测常见端口段 19290-19299
      probeTask(t, 19290).then((found) => {
        if (found) set.add(t);
        if (--pending === 0) resolve(set);
      });
    }
  });
}

function probeTask(task, port) {
  return new Promise((resolve) => {
    let p = port;
    const tryNext = () => {
      if (p > 19299) return resolve(false);
      const req = http.get('http://127.0.0.1:' + p + '/tasks', { timeout: 800 }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.ok && j.current === task) return resolve(true);
            if (j.ok && Array.isArray(j.tasks) && j.tasks.includes(task)) return resolve(true);
          } catch { /* not json */ }
          tryNext();
        });
      });
      req.on('error', () => { p++; tryNext(); });
      req.on('timeout', () => { req.destroy(); p++; tryNext(); });
    };
    tryNext();
  });
}

/* ---------- Single instance lock: one per task (different userData per task) ---------- */
app.setPath('userData', path.join(app.getPath('appData'), 'code-tutor-' + TASK));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (collapsed) toggleCollapse();
    win.show();
    win.focus();
  });
}

/* ---------- HTTP control API: DSH plugin (or anything local) can drive this window ---------- */
const http = require('http');

/* DSH bridge chat endpoint: the floating window is standalone, so it talks to
 * the DSH web GUI port directly; the bridge plugin answers with ctx.llm. */
const DSH_ORIGIN = 'http://127.0.0.1:19387';

/* ---------- Local file & build capabilities (the agent's hands) ---------- */
const fs = require('fs');
const fsp = require('fs/promises');
const { spawn: spawnProc } = require('child_process');

/* Keil project facts (from session context; make configurable later)
 * ⚠️ 以下路径为演示值，安装脚本会替换部分路径；Keil/工程路径请按你的机器修改 */
const KEIL_UV4 = 'D:\\keil\\UV4\\UV4.exe';
const KEIL_PROJECT = 'D:\\stm32\\c8t6\\project\\c8t6.uvprojx';
const READABLE_ROOTS = ['D:\\stm32\\c8t6', VAULT_ROOT];

function memFileFor(date) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  return path.join(MEM_DIR, `${y}-${m}-${d}.md`);
}

/** Append one conversation round to today's md (auto-create with header). */
async function memAppend(entry) {
  await fsp.mkdir(MEM_DIR, { recursive: true });
  const file = memFileFor(new Date());
  let head = '';
  try { await fsp.access(file); } catch {
    head = `# 对话记录 ${path.basename(file, '.md')}\n\n> 由 Code Tutor 悬浮窗自动写入，每轮对话追加一段。\n\n---\n\n`;
  }
  const ts = new Date().toTimeString().slice(0, 5);
  let body = `### ${ts} · ${entry.who === 'user' ? '我' : 'Code Tutor'}\n\n`;
  body += (entry.who === 'user' ? entry.text : entry.text.split('\n').map((l) => '> ' + l).join('\n')) + '\n\n';
  await fsp.appendFile(file, head + body, 'utf8');
  return { ok: true, file };
}

/** GET /memory/list?task= -> md files in that task's sub-vault, newest first */
async function memList(task) {
  try {
    const dir = task === TASK ? MEM_DIR : path.join(VAULT_ROOT, '任务-' + task, '对话记录');
    const names = await fsp.readdir(dir);
    return names.filter((n) => n.endsWith('.md')).sort().reverse();
  } catch { return []; }
}

/** GET /memory/read?task=&name= -> raw text */
async function memRead(task, name) {
  if (!/^[\w-]+\.md$/.test(name)) throw new Error('非法文件名');
  const dir = task === TASK ? MEM_DIR : path.join(VAULT_ROOT, '任务-' + task, '对话记录');
  return fsp.readFile(path.join(dir, name), 'utf8');
}

function pathAllowed(p) {
  const norm = String(p || '').replace(/\//g, '\\').toLowerCase();
  return READABLE_ROOTS.some((root) => norm.startsWith(root.toLowerCase()));
}

/** GET /file/read?path=...  -> { ok, content } (text files inside allowed roots) */
async function readFileText(p) {
  if (!pathAllowed(p)) throw new Error('路径不在允许范围内: ' + READABLE_ROOTS.join(' , '));
  const stat = await fsp.stat(p);
  if (stat.size > 512 * 1024) throw new Error('文件过大 (>512KB)');
  return fsp.readFile(p, 'utf8');
}

/** GET /file/list?dir=...  -> { ok, entries: [{name, size, isDir}] } */
async function listDir(p) {
  if (!pathAllowed(p)) throw new Error('路径不在允许范围内: ' + READABLE_ROOTS.join(' , '));
  const names = await fsp.readdir(p);
  const entries = [];
  for (const name of names) {
    try {
      const st = await fsp.stat(require('path').join(p, name));
      entries.push({ name, isDir: st.isDirectory(), size: st.size });
    } catch { entries.push({ name, isDir: false, size: -1 }); }
  }
  return entries;
}

/**
 * POST /build  -> run UV4 -b (rebuild) and return build.log content.
 * UV4 exits when done; -j0 hides the GUI.
 */
function keilBuild() {
  return new Promise((resolve) => {
    const logPath = 'D:\\stm32\\c8t6\\project\\build.log';
    // Delete stale log first so we never read the previous run's content
    fs.rm(logPath, { force: true }, () => {
      const child = spawnProc(KEIL_UV4, ['-b', KEIL_PROJECT, '-j0', '-o', logPath], {
        windowsHide: true,
      });
      let settled = false;
      const finish = async (code) => {
        if (settled) return;
        settled = true;
        // give UV4 a moment to flush the log
        setTimeout(async () => {
          let log = '';
          try { log = await fsp.readFile(logPath, 'utf8'); } catch { log = '(build.log 读取失败)'; }
          resolve({ exitCode: code, log });
        }, 800);
      };
      child.on('exit', (code) => finish(code));
      child.on('error', (err) => finish(-1, err.message));
      // safety: UV4 sometimes lingers; force-finish after 90s
      setTimeout(() => finish(-2), 90000);
    });
  });
}

function askBridge(text, history) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text, history });
    const req = http.request(DSH_ORIGIN + '/code-tutor/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout: 130000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ok) resolve(String(json.text || ''));
          else reject(new Error(String(json.error || 'HTTP ' + res.statusCode)));
        } catch { reject(new Error('bridge 返回非 JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('chat 请求超时')));
    req.end(body);
  });
}

function startControlServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let payload = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { /* ignore */ }
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const urlPath = req.url.split('?')[0]; // /memory/list?task=x -> /memory/list

      if (req.url === '/show' && req.method === 'POST') {
        if (!win) return send(500, { ok: false, error: 'window not ready' });
        if (collapsed) toggleCollapse();
        win.show(); win.focus();
        return send(200, { ok: true });
      }
      if (req.url === '/push' && req.method === 'POST') {
        // DSH pushes a message into the floating window, e.g. project summary or plan
        if (!win) return send(500, { ok: false, error: 'window not ready' });
        win.webContents.send('ct:push', String(payload.text || ''), String(payload.who || 'ai'));
        win.show();
        return send(200, { ok: true });
      }
      if (req.url === '/status' && req.method === 'GET') {
        return send(200, { ok: true, running: !!win, collapsed });
      }
      if (urlPath === '/file/read' && req.method === 'GET') {
        const q = new URL(req.url, 'http://x').searchParams;
        readFileText(q.get('path')).then(
          (content) => send(200, { ok: true, content }),
          (err) => send(400, { ok: false, error: err.message }),
        );
        return;
      }
      if (urlPath === '/file/list' && req.method === 'GET') {
        const q = new URL(req.url, 'http://x').searchParams;
        listDir(q.get('dir')).then(
          (entries) => send(200, { ok: true, entries }),
          (err) => send(400, { ok: false, error: err.message }),
        );
        return;
      }
      if (req.url === '/build' && req.method === 'POST') {
        keilBuild().then((r) => send(200, { ok: true, ...r }));
        return;
      }
      if (urlPath === '/memory/save' && req.method === 'POST') {
        const entry = { who: String(payload.who || 'ai'), text: String(payload.text || '') };
        memAppend(entry)
          .then(async (r) => {
            // 异步分类：归属其他任务则搬家（失败静默，不影响保存）
            try {
              const target = await classifyRound(entry.text);
              if (target && target !== TASK) await moveToTask(entry, target);
            } catch (e) { console.error('classify:', e.message); }
            send(200, r);
          }, (err) => send(500, { ok: false, error: err.message }));
        return;
      }
      if (urlPath === '/memory/list' && req.method === 'GET') {
        // ?task= 可选：查看其他任务的子库（缺省 = 当前任务）
        const q = new URL(req.url, 'http://x').searchParams;
        const t = String(q.get('task') || TASK).replace(/[\\/:*?"<>|]/g, '_');
        memList(t).then((files) => send(200, { ok: true, files, current: TASK }), (err) => send(500, { ok: false, error: err.message }));
        return;
      }
      if (urlPath === '/memory/read' && req.method === 'GET') {
        const q = new URL(req.url, 'http://x').searchParams;
        const t = String(q.get('task') || TASK).replace(/[\\/:*?"<>|]/g, '_');
        memRead(t, q.get('name') || '').then(
          (content) => send(200, { ok: true, content }),
          (err) => send(400, { ok: false, error: err.message }),
        );
        return;
      }
      if (urlPath === '/tasks' && req.method === 'GET') {
        taskList().then((tasks) => send(200, { ok: true, tasks, current: TASK }), (err) => send(500, { ok: false, error: err.message }));
        return;
      }
      if (urlPath === '/launch' && req.method === 'POST') {
        // 异步启动：立即返回"已发起"，新实例就绪后自己会出现在 /tasks
        launchTask(String(payload.task || ''), Array.isArray(payload.preload) ? payload.preload : null)
          .catch((e) => console.error('launch:', e.message));
        send(200, { ok: true, launched: String(payload.task || '') });
        return;
      }
      if (urlPath === '/resume/take' && req.method === 'GET') {
        resumeTake().then((r) => send(200, { ok: true, resume: r }), (err) => send(500, { ok: false, error: err.message }));
        return;
      }
      if (req.url === '/chat' && req.method === 'POST') {
        // Renderer asks a question; main process forwards it to the DSH bridge.
        if (!win) return send(500, { ok: false, error: 'window not ready' });
        askBridge(String(payload.text || ''), Array.isArray(payload.history) ? payload.history : [])
          .then((text) => send(200, { ok: true, text }))
          .catch((err) => send(500, { ok: false, error: err.message }));
        return;
      }
      return send(404, { ok: false, error: 'unknown endpoint' });
    });
  });
  server.listen(CTRL_PORT, '127.0.0.1', () => console.log('control server on', CTRL_PORT, 'task', TASK));
  server.on('error', (e) => console.error('control server error:', e.message));
}

app.whenReady().then(async () => {
  createWindow();
  createTray();
  startControlServer();
  setInterval(clampIntoScreen, 1500);
  setInterval(enforceSize, 400);
  win.on('resize', enforceSize);
  try { await registerTask(); } catch (e) { console.error('registerTask:', e.message); }
  // 右键菜单：复制/粘贴/全选（消息区可划选后右键复制）
  win.webContents.on('context-menu', (_e, params) => {
    const menu = Menu.buildFromTemplate([
      { role: 'copy', label: '复制', enabled: params.editFlags.canCopy },
      { role: 'paste', label: '粘贴', enabled: params.editFlags.canPaste },
      { role: 'selectAll', label: '全选' },
    ]);
    menu.popup({ window: win });
  });
  // Ctrl+C / Ctrl+A 快捷键（聚焦窗口即可用）
  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key.toLowerCase() === 'c') { win.webContents.copy(); event.preventDefault(); }
    if (input.control && input.key.toLowerCase() === 'a') { win.webContents.selectAll(); event.preventDefault(); }
  });
});

app.on('window-all-closed', () => {
  // Tray keeps the app alive; quit only via tray Quit.
});
