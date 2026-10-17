/**
 * Code Tutor Bridge - Host half.
 *
 * Routes (webServer, same-origin for the DSH page):
 *   GET  /code-tutor/status   -> { running }
 *   POST /code-tutor/launch   -> spawn floating window if closed, then show
 *   POST /code-tutor/push     -> { text, who } push a message into the window
 *   POST /code-tutor/chat     -> { text, history? } LLM chat via ctx.llm (workbuddy)
 *
 * Agent tools:
 *   code_tutor_push  - push text into the floating window
 *   code_tutor_show  - show/focus (auto-launch) the floating window
 *
 * The floating window (independent Electron app) lives at the configured appDir
 * (default D:\办公任务\code-tutor, control server on 127.0.0.1:19290).
 *
 * LLM routing follows the user's global model rules: provider workbuddy,
 * model deepseek-v4.1-flash (never paid official API).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'code-tutor-bridge';

export const inject = ['tools', 'webServer', 'llm'];

const SYSTEM_PROMPT = [
  '你是 Code Tutor，一个面向单片机初学者的独立悬浮代码助教（Keil/STM32 标准外设库）。',
  '教学铁律：用户说要写什么文件时，先给出函数规划清单——每个函数的名字、作用、参数，【绝不在规划阶段给出实现代码】。',
  '用户写完代码请求检验时：读用户文件，判断能否编译运行不报错，给出准确度和可优化点（优化由用户决定是否采纳）。',
  '用户点【给我代码】时才给出该函数的完整实现并逐段讲解。',
  '用户自己定义了函数名时，接受用户的命名并同步到规划里。',
  '当前工程：D:\\stm32\\c8t6，STM32F103C8，标准外设库，软件 IIC（PB8=SCL，PB9=SDA），目标 0.96 寸 OLED（SSD1306，IIC 地址 0x78）。',
  '回答用简体中文，代码注释也用中文，精炼、面向初学者。',
  '',
  '【对话历史】每次回答前，先读会话上下文文件 D:\\办公任务\\aux_files\\context\\session_context.md（若存在），它记录了本项目的开发对话史、已写代码位置和已做决定。回答要与上下文一致，不要重复问已确认过的问题。',
  '',
  '【选项交互】当你的回答中出现需要用户决策的问题时（比如"用哪种方式""要不要加XX""A还是B"），必须在回答的最末尾追加一个选项块，格式严格为：',
  '[OPTIONS]',
  'A=选项文字',
  'B=选项文字',
  'C=选项文字',
  '（每行一个，等号连接，最多 4 个选项；没有需要决策的问题时不要输出选项块。）',
  '用户的回复可能只是"a"或"B"这样的单个字母，此时把它理解为你上一条选项块里的对应选项。',
  '',
  '【图示能力】当解释时序、电路、数据流、代码结构时，优先用 HTML+SVG 画图辅助理解。输出方式：在回答中用 \`\`\`html 代码块包裹一段自包含的 HTML（内联样式，浅色背景，宽度不超 340px，不要引用外部资源）。悬浮窗会把每个 html 块渲染成真实的图。画 IIC 时序图用横线+高低电平折线表示 SCL/SDA，标注起始/停止/应答位置；画结构图用方框+箭头。这段 html 不算"给代码"，教学铁律（规划期不给实现代码）不适用于图示。',
].join('\n');

const CHAT_MAX_TOKENS = 8192;
const CHAT_TIMEOUT_MS = 120000;
const CONTEXT_FILE = 'D:\\办公任务\\aux_files\\context\\session_context.md';

export function apply(ctx, config = {}) {
  const port = Number(config.controlPort) > 0 ? Number(config.controlPort) : 19290;
  const base = 'http://127.0.0.1:' + port;
  const appDir = typeof config.appDir === 'string' && config.appDir.length > 0
    ? config.appDir
    : 'D:\\办公任务\\code-tutor';
  const electronExe = join(appDir, 'electron.exe');
  const provider = typeof config.provider === 'string' && config.provider ? config.provider : 'workbuddy';
  const model = typeof config.model === 'string' && config.model ? config.model : 'deepseek-v4.1-flash';

  async function post(path, body) {
    let response;
    try {
      response = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000),
      });
    } catch (error) {
      return { ok: false, error: 'Code Tutor 悬浮窗未运行: ' + (error instanceof Error ? error.message : String(error)) };
    }
    if (!response.ok) return { ok: false, error: 'HTTP ' + response.status };
    return { ok: true };
  }

  async function isRunning() {
    try {
      const response = await fetch(base + '/status', { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return false;
      const json = await response.json();
      return json.running === true;
    } catch {
      return false;
    }
  }

  function launchProcess() {
    if (!existsSync(electronExe)) {
      return Promise.resolve({ ok: false, error: '未找到 ' + electronExe });
    }
    return new Promise((resolve) => {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      let settled = false;
      const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
      try {
        const child = spawn(electronExe, ['.'], {
          cwd: appDir,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env,
        });
        child.on('error', (error) => finish({ ok: false, error: '启动失败: ' + error.message }));
        child.unref();
      } catch (error) {
        return finish({ ok: false, error: '启动异常: ' + (error instanceof Error ? error.message : String(error)) });
      }
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts += 1;
        if (await isRunning()) {
          clearInterval(timer);
          finish({ ok: true });
        } else if (attempts > 16) {
          clearInterval(timer);
          finish({ ok: false, error: '悬浮窗进程已启动但控制 API 未就绪（端口 ' + port + '）' });
        }
      }, 500);
    });
  }

  async function ensureShown() {
    if (await isRunning()) {
      const shown = await post('/show', {});
      return shown.ok ? { ok: true } : { ok: false, error: shown.error };
    }
    const launched = await launchProcess();
    if (!launched.ok) return launched;
    await post('/show', {});
    return { ok: true, launched: true };
  }

  /** Read the session-context MD (development history, code locations). Cached 30s. */
  let contextCache = { text: '', at: 0 };
  async function sessionContext() {
    if (Date.now() - contextCache.at < 30000) return contextCache.text;
    try {
      const { readFile } = await import('node:fs/promises');
      contextCache = { text: await readFile(CONTEXT_FILE, 'utf8'), at: Date.now() };
    } catch {
      contextCache = { text: '', at: Date.now() };
    }
    return contextCache.text;
  }

  /** One LLM chat completion through the harness llm service. Returns the text. */
  async function chat(text, history) {
    const { createUserMessage, createSystemMessage, BlockAssembler } = await import('@deepseek-ai/dsh-llm');
    const ctxDoc = await sessionContext();
    const system = ctxDoc
      ? SYSTEM_PROMPT + '\n\n【会话上下文快照（本开发项目的对话史与代码位置）】\n' + ctxDoc
      : SYSTEM_PROMPT;
    const messages = [createSystemMessage(system)];
    // 硬件档案注入（悬浮窗随请求带上；老版本悬浮窗没有该字段则跳过）
    const hw = typeof payload.hw === 'string' && payload.hw.trim() ? payload.hw.trim() : '';
    if (hw) {
      messages.push(createSystemMessage(hw));
    }
    for (const turn of Array.isArray(history) ? history.slice(-8) : []) {
      if (typeof turn?.text !== 'string' || turn.text.length === 0) continue;
      messages.push(createUserMessage({
        content: [{ type: 'text', text: String(turn.text) }],
        source: { kind: 'code-tutor-bridge' },
      }));
    }
    messages.push(createUserMessage({
      content: [{ type: 'text', text: String(text) }],
      source: { kind: 'code-tutor-bridge' },
    }));
    const options = Object.freeze({
      provider,
      model,
      messages,
      maxTokens: CHAT_MAX_TOKENS,
      purpose: 'code-tutor-chat',
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    const assembler = new BlockAssembler();
    for await (const chunk of ctx.llm.stream(options)) {
      assembler.push(chunk);
    }
    const finish = assembler.finish;
    const answer = assembler.blocks().filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (finish && finish.kind === 'max-tokens') {
      // 回复被 max_tokens 截断：已有文本仍然有效，附上截断提示而不是报错
      if (answer.length === 0) throw new Error('LLM 输出被 max_tokens 截断且无内容');
      return answer + '\n\n（回复因长度上限被截断，可让我"继续"接上）';
    }
    if (finish && finish.kind !== 'stop') {
      const detail = finish.failure?.message ?? finish.kind;
      throw new Error('LLM 未正常完成: ' + detail);
    }
    if (answer.length === 0) throw new Error('LLM 返回空内容');
    return answer;
  }

  /** Push a message into the floating window (auto-launch). */
  async function pushToWindow(text, who) {
    const ensure = await ensureShown();
    if (!ensure.ok) return { ok: false, error: ensure.error };
    const result = await post('/push', { text, who });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  ctx.tools.register({
    name: 'code_tutor_push',
    description: '把一段文本推送到 Code Tutor 独立悬浮窗显示（工程介绍、函数规划、代码讲解、检查结果等）。悬浮窗不随 DSH 最小化消失，适合放置需要长期可见的学习内容。若悬浮窗未运行会自动先启动它。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要显示的文本（支持较长内容，会追加到悬浮窗对话区）' },
        who: { type: 'string', enum: ['ai', 'user'], description: '"ai"（默认，助手消息）或 "user"' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const result = await pushToWindow(String(args.text), args.who === 'user' ? 'user' : 'ai');
      return result.ok ? '已推送到悬浮窗' : '推送失败: ' + result.error;
    },
  });

  ctx.tools.register({
    name: 'code_tutor_show',
    description: '显示并聚焦 Code Tutor 独立悬浮窗；若未运行会自动启动它（若收起会先展开）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute() {
      const result = await ensureShown();
      return result.ok ? '悬浮窗已显示' : '显示失败: ' + result.error;
    },
  });

  // ---- Web routes ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/code-tutor/status',
    handler: async (req, res) => {
      const running = await isRunning();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ running }));
    },
  }), 'code-tutor-bridge: GET /code-tutor/status');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/code-tutor/launch',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
        return;
      }
      const result = await ensureShown();
      res.writeHead(result.ok ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    },
  }), 'code-tutor-bridge: POST /code-tutor/launch');

  // Push route: DSH-side flows (or the agent via its own tool) may push directly.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/code-tutor/push',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
      req.on('end', async () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch { /* ignore */ }
        const result = await pushToWindow(String(payload.text ?? ''), payload.who === 'user' ? 'user' : 'ai');
        res.writeHead(result.ok ? 200 : 500, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      });
    },
  }), 'code-tutor-bridge: POST /code-tutor/push');

  // Chat route: floating window asks, harness llm answers (workbuddy route).
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/code-tutor/chat',
    handler: async (req, res) => {      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
      req.on('end', async () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch { /* ignore */ }
        const text = String(payload.text ?? '').trim();
        if (text.length === 0) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'text is required' }));
          return;
        }
        try {
          const answer = await chat(text, payload.history);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, text: answer }));
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  }), 'code-tutor-bridge: POST /code-tutor/chat');

  // Classify route: floating window asks which task a message belongs to.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/code-tutor/classify',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 100_000) req.destroy(); });
      req.on('end', async () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch { /* ignore */ }
        const text = String(payload.text ?? '').trim();
        const candidates = Array.isArray(payload.candidates) ? payload.candidates.filter((x) => typeof x === 'string') : [];
        if (text.length === 0 || candidates.length === 0) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'text and candidates are required' }));
          return;
        }
        try {
          const { createUserMessage, createSystemMessage, BlockAssembler } = await import('@deepseek-ai/dsh-llm');
          const sys = '你是分类器。判断这条消息属于哪个任务主题。只输出任务名，不要任何其他内容。若都不属于或不确定，输出 OTHER。候选：' + candidates.join('、');
          const options = Object.freeze({
            provider, model,
            messages: [
              createSystemMessage(sys),
              createUserMessage({ content: [{ type: 'text', text: text.slice(0, 500) }], source: { kind: 'code-tutor-bridge' } }),
            ],
            maxTokens: 20,
            purpose: 'code-tutor-classify',
            signal: AbortSignal.timeout(25000),
          });
          const assembler = new BlockAssembler();
          for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk);
          const out = assembler.blocks().filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
          const match = candidates.find((t) => out.includes(t));
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, task: match || 'OTHER', raw: out.slice(0, 50) }));
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  }), 'code-tutor-bridge: POST /code-tutor/classify');
}
