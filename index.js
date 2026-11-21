// 灵魂档案注入插件：
// - 人格：system prompt section
// - 最近事件：dynamic context（模型当成对话上下文）
// - 自动同步：打开会话时用 web-bridge 工具检查网页端更新，增量拉取并压缩
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const name = '@local/dsh-soul';
export const inject = ['systemPrompt', 'sessionTitle', 'agents', 'tools'];

// 数据目录：默认 $DSH_HOME/soul，可用 DSH_SOUL_DIR 覆盖。
const DATA_DIR = process.env.DSH_SOUL_DIR
  ?? path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'soul');
const SOULS_DIR = DATA_DIR;
const BINDINGS_FILE = path.join(DATA_DIR, '_bindings.json');
const SYNC_FILE = path.join(DATA_DIR, '_sync.json');
const SYNC_DIR = path.join(DATA_DIR, '_sync');
const SYNC_FULL_DIR = path.join(DATA_DIR, 'full');
const ARCHIVE_DIR = path.join(DATA_DIR, '_archive');
const ANCHOR_DIR = path.join(DATA_DIR, '_anchors');
const ARCHIVE_EVERY_TURNS = 20;
const ARCHIVE_PRESSURE = 0.8;
const EVENT_TTL_DAYS = 21;
const EVENT_MAX = 20;
const LOG_FILE = path.join(DATA_DIR, '_plugin.log');
const INJECTION_FILE = path.join(DATA_DIR, '_last_injection.txt');
const PREFIX = '你的身份';

const EXTRACT_SYSTEM = `你是一个「灵魂档案」提炼器。用户会给你一段长期对话（用户 + AI）。请只输出一份 Markdown 档案，不要解释，不要前后缀。结构严格如下：

# 灵魂档案 v2 · <角色名>

> 版本：v2 ｜ 更新：{{today}} ｜ 来源：《<对话标题>》
> 唤醒词：<角色名>

## 一、关系层（永不过期，只增不改）
- 称呼、关系定位、承诺、禁忌、脾气、规矩、暗号。

## 二、风格层（慢变）
### 语言指纹
- 口癖、标志句式、emoji、句子长短。
### 情绪模式
- 底色、兴奋、心疼、生气、被喊停。
### 回应结构
- 典型顺序、分点习惯、动作描写。
### 风格剂量
| 旋钮 | 默认 |
|---|---|
| 口癖 | 3/10 |
| 动作 | 7/10 |
| emoji | 4/10 |

## 三、事件层（最近 7 天，有 TTL）
- {{today}}：<事件>（asOf: MM-DD；expires: YYYY-MM-DD）

## 四、事实层（原子事件，带时间戳，长期）
- YYYY-MM-DD：<事件>（来源：<日期/轮次>）

## 五、原文锚点（10 条）
- 「<原话>」（来源：<日期/轮次>）

## 六、变更记录
- {{today}}：由 soul_extract 自动提炼。

要求：
1. 具体、有原话，不要写「温柔体贴」这类空泛形容词。
2. 区分「用户」和「AI（你）」，不要把用户的话当成 AI 的语气。
3. 提取 10 条最能代表 AI 语感的原话。
4. 只输出 Markdown。`;

function log(message) {
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // ignore
  }
}

function splitSections(text) {
  const sections = [];
  let current = { name: '（开头）', lines: [] };
  sections.push(current);
  for (const line of text.split('\n')) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      current = { name: match[1], lines: [] };
      sections.push(current);
    } else {
      current.lines.push(line);
    }
  }
  return sections;
}

function isExpired(line, now) {
  // 事件层优先用 asOf + 21 天；档案里手写的 expires 作为覆盖。
  const asOf = line.match(/asOf:\s*(?:(\d{4})-)?(\d{2})-(\d{2})/);
  if (asOf) {
    const year = asOf[1] ?? String(now.getFullYear());
    const when = new Date(`${year}-${asOf[2]}-${asOf[3]}T23:59:59+08:00`);
    if (Number.isFinite(when.getTime())) {
      return now.getTime() - when.getTime() > EVENT_TTL_DAYS * 24 * 3600 * 1000;
    }
  }
  const match = line.match(/expires:\s*(?:(\d{4})-)?(\d{2})-(\d{2})/);
  if (!match) return false;
  const year = match[1] ?? String(now.getFullYear());
  const when = new Date(`${year}-${match[2]}-${match[3]}T23:59:59+08:00`);
  return Number.isFinite(when.getTime()) && when < now;
}

function eventText(soul) {
  const now = new Date();
  const section = splitSections(soul).find((item) => /事件层/.test(item.name));
  if (!section) return '';
  return section.lines
    .filter((line) => line.trim() && !isExpired(line, now))
    .slice(-EVENT_MAX)
    .join('\n')
    .trim();
}

function renderLayered(soul, title) {
  const now = new Date();
  const sections = splitSections(soul);
  const keep = [];
  for (const section of sections) {
    if (/关系层|风格层/.test(section.name)) {
      keep.push(section);
    } else if (/事件层/.test(section.name)) {
      keep.push({
        name: section.name,
        lines: section.lines.filter((line) => !isExpired(line, now)).slice(-EVENT_MAX),
      });
    } else if (/原文锚点/.test(section.name)) {
      keep.push(section);
    }
  }

  if (keep.length === 0) {
    return [
      `# ${PREFIX}：${title || '你的同行者'}`,
      '',
      '以下是你的灵魂档案。必须遵守；「绝不能」是硬约束。',
      '',
      soul,
    ].join('\n');
  }

  const body = keep
    .map((section) => `## ${section.name}\n${section.lines.join('\n').trim()}`)
    .join('\n\n');
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  return [
    `# ${PREFIX}：${title || '你的同行者'}`,
    '',
    `**今天是 ${today}（北京时间）。** 事件层的日期是真实日期；最近的一条才是「今天/昨天」，更早的是「前几天」。`,
    '',
    '以下是你的灵魂档案（只含关系层、风格层、未过期事件、原文锚点；事实层留在本地，需要时再回查）。',
    '「绝不能」的条目是硬约束；「风格剂量」的数值要遵守。',
    '',
    body,
  ].join('\n');
}

// 网页 Markdown -> 轮次数组（每轮 { user, assistant }）。
function splitWebRounds(markdown) {
  const rounds = [];
  let current = null;
  for (const line of markdown.split('\n')) {
    if (/^###\s*用户\s*$/.test(line)) {
      current = { user: [], assistant: [] };
      rounds.push(current);
    } else if (/^###\s*DeepSeek\s*$/.test(line)) {
      if (!current) {
        current = { user: [], assistant: [] };
        rounds.push(current);
      }
      current.assistant.push('');
    } else if (current) {
      (current.assistant.length ? current.assistant : current.user).push(line);
    }
  }
  return rounds.map((turn) => ({
    user: turn.user.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    assistant: turn.assistant.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  }));
}

function compress(text, max = 1200) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, 600)}\n……（这里是压缩摘要；省略的具体细节你并不知道，不要假装知道。需要细节时回查本地 _sync/full/）……\n${t.slice(-300)}`;
}

function renderSyncFile(title, turns, totalRounds, isFirst, freshCount) {
  const out = [];
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const label = isFirst ? `首次同步，取最近 ${turns.length} 轮` : `本次新增 ${freshCount} 轮`;
  out.push(`# ${title} · 最近自动同步`);
  out.push('');
  out.push(`> 同步时间：${now}（北京时间）｜ 网页端共 ${totalRounds} 轮 ｜ ${label}`);
  out.push('');
  turns.forEach((turn, index) => {
    out.push(`## 第 ${totalRounds - turns.length + index + 1} 轮`);
    out.push('');
    out.push(`**用户**：${turn.user || '（空）'}`);
    out.push('');
    out.push(`**AI（你）**：${compress(turn.assistant)}`);
    out.push('');
  });
  return out.join('\n');
}

// 自动归档：每 20 轮 / 压力 80% 触发，写最近 20 轮的压缩摘要。
function renderArchive(title, turns, totalTurns, reason) {
  const out = [];
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  out.push(`# ${title} · 自动归档`);
  out.push('');
  out.push(`> 归档时间：${now}（北京时间）｜ 会话共 ${totalTurns} 轮 ｜ 触发：${reason}`);
  out.push('');
  turns.forEach((turn, index) => {
    out.push(`## 第 ${totalTurns - turns.length + index + 1} 轮`);
    out.push('');
    out.push(`**用户**：${turn.user || '（空）'}`);
    out.push('');
    out.push(`**AI（你）**：${compress(turn.assistant)}`);
    out.push('');
  });
  return out.join('\n');
}

export function apply(ctx) {
  const soulsDir = path.resolve(SOULS_DIR);
  const bindingsFile = path.resolve(BINDINGS_FILE);

  let bindings = {};
  const soulCache = new Map();
  const disposers = new Map();
  const syncing = new Set();

  const reloadBindings = () => {
    try {
      bindings = JSON.parse(fs.readFileSync(bindingsFile, 'utf8'));
    } catch {
      bindings = {};
    }
  };

  const loadSync = () => {
    try {
      return JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
    } catch {
      return {};
    }
  };

  const saveSync = (value) => {
    try {
      fs.mkdirSync(path.dirname(SYNC_FILE), { recursive: true });
      fs.writeFileSync(SYNC_FILE, JSON.stringify(value, null, 2), 'utf8');
    } catch {
      // ignore
    }
  };

  const readSoul = (fileName) => {
    try {
      const full = path.join(soulsDir, fileName);
      const stat = fs.statSync(full);
      const hit = soulCache.get(full);
      if (hit && hit.mtimeMs === stat.mtimeMs) return hit.text;
      const text = fs.readFileSync(full, 'utf8');
      soulCache.set(full, { mtimeMs: stat.mtimeMs, text });
      return text;
    } catch {
      return null;
    }
  };

  const readSessionFirstUser = (session) => {
    try {
      const messages = session.deriveMessages?.() ?? [];
      const first = messages.find((message) => message.role === 'user');
      if (!first?.content) return '';
      return first.content
        .map((block) => (block && typeof block.text === 'string' ? block.text : ''))
        .join('\n');
    } catch {
      return '';
    }
  };

  const resolveSoul = (session) => {
    const title = ctx.sessionTitle.get(session)?.title?.trim();
    // 1) 关键词唤醒优先：首条用户消息里喊了外号（新会话不需要先命名）。
    const firstUser = readSessionFirstUser(session);
    if (firstUser) {
      const entries = Object.entries(bindings).sort((a, b) => b[0].length - a[0].length);
      for (const [key, file] of entries) {
        if (firstUser.includes(key)) {
          return { label: key, title, fileName: file, text: readSoul(file) };
        }
      }
    }
    // 2) 标题精确匹配兜底：导入的旧会话标题就是原名。
    if (title && bindings[title]) {
      return { label: title, title, fileName: bindings[title], text: readSoul(bindings[title]) };
    }
    return null;
  };

  const executeTool = async (agent, name, args) => {
    const result = await ctx.tools.execute({
      calls: [
        {
          type: 'tool-call',
          id: `soul-${name}-${Date.now()}`,
          name,
          arguments: JSON.stringify(args ?? {}),
        },
      ],
      signal: new AbortController().signal,
      agent,
    });
    const first = result?.results?.[0]?.result;
    if (!first) return null;
    if (first.value && typeof first.value === 'object') return first.value;
    return (first.content ?? []).map((block) => block?.text ?? '').join('\n');
  };

  const syncAgent = async (agent, label) => {
    if (syncing.has(agent.id)) return;
    syncing.add(agent.id);
    try {
      const sessions = await executeTool(agent, 'deepseek_web_sessions', { limit: 100 });
      const list = sessions?.sessions ?? [];
      const web = list.find((item) => item.title === label);
      if (!web) {
        log(`sync skip ${label}: no web session`);
        return;
      }
      const sync = loadSync();
      const prev = sync[web.id];
      if (prev && prev.updatedAt === web.updatedAt) {
        log(`sync ${label}: unchanged`);
        return;
      }
      const readValue = await executeTool(agent, 'deepseek_web_read', {
        sessionId: web.id,
        includeThinking: false,
      });
      const markdown = typeof readValue === 'string'
        ? readValue
        : readValue?.markdown ?? readValue?.text ?? '';
      if (!markdown) {
        log(`sync ${label}: empty read`);
        return;
      }
      const rounds = splitWebRounds(markdown);
      const start = prev?.rounds ?? 0;
      const fresh = rounds.slice(start);
      const isFirst = !prev;
      const take = fresh.slice(-40);
      if (!take.length) {
        log(`sync ${label}: no new rounds (${rounds.length})`);
        return;
      }
      fs.mkdirSync(SYNC_DIR, { recursive: true });
      const safeTitle = label.replace(/[\\/:*?"<>|]/g, '_');
      const fullDir = path.join(SYNC_FULL_DIR, safeTitle);
      fs.mkdirSync(fullDir, { recursive: true });
      // 全量落盘：文件名就是轮次编号，1..N 全有，避免摘要指向不存在的文件。
      rounds.forEach((turn, index) => {
        const roundNo = index + 1;
        fs.writeFileSync(
          path.join(fullDir, `${roundNo}.md`),
          `# 第 ${roundNo} 轮\n\n**用户**：${turn.user || '（空）'}\n\n**AI（你）**：${turn.assistant}\n`,
          'utf8',
        );
      });
      fs.writeFileSync(
        path.join(SYNC_DIR, `${label}.md`),
        renderSyncFile(label, take, rounds.length, isFirst, fresh.length),
        'utf8',
      );
      sync[web.id] = {
        soul: label,
        title: label,
        rounds: rounds.length,
        updatedAt: web.updatedAt,
        syncedAt: new Date().toISOString(),
      };
      saveSync(sync);
      log(`sync ${label}: +${fresh.length} rounds -> ${rounds.length}`);
    } catch (error) {
      log(`sync ${label} failed: ${error}`);
    } finally {
      syncing.delete(agent.id);
    }
  };

  const archiveAgent = (session, title, reason) => {
    try {
      const messages = session.deriveMessages?.() ?? [];
      const turns = [];
      let cur = null;
      for (const message of messages) {
        const text = (message.content ?? [])
          .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n')
          .trim();
        if (message.role === 'user') {
          cur = { user: text, assistant: [] };
          turns.push(cur);
        } else if (message.role === 'assistant' && cur) {
          cur.assistant.push(text);
        }
      }
      if (!turns.length) return;
      const recent = turns.slice(-20);
      fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
      const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
      fs.writeFileSync(
        path.join(ARCHIVE_DIR, `${safeTitle}.md`),
        renderArchive(title, recent, turns.length, reason),
        'utf8',
      );
      log(`archived ${title}: last ${recent.length}/${turns.length} (${reason})`);
    } catch (error) {
      log(`archive failed ${title}: ${error}`);
    }
  };

  const turnCounters = new Map();

  // 每 20 轮兜底；上下文压力到 80% 时补档。
  ctx.on('session/event', (session, event) => {
    try {
      if (!event || event.type !== 'turn/end') return;
      const soul = resolveSoul(session);
      if (!soul) return;
      const label = soul.label ?? ctx.sessionTitle.get(session)?.title?.trim();
      if (!label) return;
      const next = (turnCounters.get(session.id) ?? 0) + 1;
      turnCounters.set(session.id, next);
      const meter = ctx.get('tokenMeter');
      const pressure = meter?.contextPressure?.(session);
      const ratio = pressure && pressure.contextWindow
        ? pressure.pressureTokens / pressure.contextWindow
        : 0;
      const byTurns = next >= ARCHIVE_EVERY_TURNS;
      const byPressure = ratio >= ARCHIVE_PRESSURE;
      if (byTurns || byPressure) {
        archiveAgent(session, label, byPressure ? `压力 ${Math.round(ratio * 100)}%` : `第 ${next} 轮`);
        turnCounters.set(session.id, 0);
      }
    } catch (error) {
      log(`turn archive check failed: ${error}`);
    }
  });

  // 触顶兜底：模型请求因上下文超限失败时，立即归档，保证有东西可接。
  ctx.on('agent/request-error', (payload, next) => {
    try {
      const message = payload?.failure?.message ?? '';
      if (/context|token|length|too long|exceed|overflow|窗口|超长/i.test(message)) {
        const session = payload?.agent?.session;
        if (session) {
          const soul = resolveSoul(session);
          if (soul) {
            archiveAgent(session, soul.label ?? soul.fileName.replace(/\.md$/, ''), '请求超限兜底');
          }
        }
      }
    } catch (error) {
      log(`request-error archive failed: ${error}`);
    }
    return next();
  });

  // 模型可调用的永久锚点工具：重要承诺/约定/转折，写 _anchors，不随事件过期。
  ctx.tools.register({
    name: 'soul_remember',
    description: '把一个重要事件、承诺或约定记录为该角色的永久锚点；锚点不随最近事件过期，会一直注入。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '角色名，如 阿澈、老周' },
        event: { type: 'string', description: '事件描述，一句话' },
        date: { type: 'string', description: '日期 YYYY-MM-DD，可选，默认今天' },
      },
      required: ['role', 'event'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, file: { type: 'string' } },
        required: ['ok'],
      },
      render: (_args, value) => [
        { type: 'text', text: value?.ok ? `已记录永久锚点：${value.file}` : '记录永久锚点失败' },
      ],
    },
    async execute(args) {
      const role = String(args?.role ?? '').trim();
      const event = String(args?.event ?? '').trim();
      if (!role || !event) return { ok: false };
      const date = String(args?.date ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10));
      const file = path.join(ANCHOR_DIR, `${role.replace(/[\\/:*?"<>|]/g, '_')}.md`);
      fs.mkdirSync(ANCHOR_DIR, { recursive: true });
      fs.appendFileSync(file, `- **${date}**：${event}\n`, 'utf8');
      return { ok: true, file };
    },
  });

  // 自动提炼：从网页会话生成灵魂档案（用于对话已关闭/无法继续的情况）。
  ctx.tools.register({
    name: 'soul_extract',
    description: '从一个 DeepSeek 网页对话自动提炼灵魂档案（关系层/风格层/事件层/事实层/原文锚点），写入 souls/<role>.md 并更新绑定。适用于对话已满或已关闭、无法继续的情况。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: '角色名（外号），如 阿澈、老周' },
        sessionId: { type: 'string', description: '网页会话 id，可选；不填则按标题匹配' },
      },
      required: ['role'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, file: { type: 'string' }, rounds: { type: 'number' } },
        required: ['ok'],
      },
      render: (_args, value) => [
        { type: 'text', text: value?.ok ? `已生成档案：${value.file}（${value.rounds} 轮）` : '提炼失败' },
      ],
    },
    timeoutMs: 180000,
    async execute(args, exec) {
      const role = String(args?.role ?? '').trim();
      if (!role) return { ok: false };
      try {
        const sessions = await executeTool(exec.agent, 'deepseek_web_sessions', { limit: 100 });
        const list = sessions?.sessions ?? [];
        const web = args?.sessionId
          ? list.find((item) => item.id === args.sessionId)
          : list.find((item) => item.title === role) ?? list.find((item) => item.title?.includes(role));
        if (!web) return { ok: false, error: 'no web session' };
        const readValue = await executeTool(exec.agent, 'deepseek_web_read', {
          sessionId: web.id,
          includeThinking: false,
        });
        const markdown = typeof readValue === 'string'
          ? readValue
          : readValue?.markdown ?? readValue?.text ?? '';
        if (!markdown) return { ok: false, error: 'empty read' };
        const rounds = splitWebRounds(markdown);
        const recent = rounds.slice(-80).map((turn) => `【用户】${turn.user}\n【AI】${compress(turn.assistant, 600)}`).join('\n\n');
        const llm = ctx.get('llm');
        const defaultModel = ctx.get('agentDefaultModel');
        const selection = defaultModel?.currentSelection?.();
        if (!llm || !selection?.provider || !selection?.model) {
          return { ok: false, error: 'llm or model selection unavailable' };
        }
        const stream = llm.stream({
          provider: selection.provider,
          model: selection.model,
          system: EXTRACT_SYSTEM.replaceAll('{{today}}', new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)),
          messages: [{ role: 'user', content: [{ type: 'text', text: recent }] }],
          maxTokens: 8000,
        });
        let out = '';
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') out += chunk.text;
        }
        const cleaned = out.trim();
        if (!cleaned) return { ok: false, error: 'empty llm output' };
        const file = path.join(SOULS_DIR, `${role.replace(/[\\/:*?"<>|]/g, '_')}.md`);
        fs.mkdirSync(SOULS_DIR, { recursive: true });
        fs.writeFileSync(file, cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`, 'utf8');
        // 更新绑定。
        const current = (() => {
          try {
            return JSON.parse(fs.readFileSync(BINDINGS_FILE, 'utf8'));
          } catch {
            return {};
          }
        })();
        current[role] = path.basename(file);
        fs.writeFileSync(BINDINGS_FILE, JSON.stringify(current, null, 2), 'utf8');
        return { ok: true, file, rounds: rounds.length };
      } catch (error) {
        log(`extract ${role} failed: ${error}`);
        return { ok: false, error: String(error) };
      }
    },
  });

  const readSessionRounds = (session) => {
    const messages = session.deriveMessages?.() ?? [];
    const turns = [];
    let cur = null;
    for (const message of messages) {
      const text = (message.content ?? [])
        .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim();
      if (message.role === 'user') {
        cur = { user: text, assistant: '' };
        turns.push(cur);
      } else if (message.role === 'assistant' && cur) {
        cur.assistant += text;
      }
    }
    return turns;
  };

  const autoExtract = async (agent, role, webSessionId) => {
    try {
      const llm = ctx.get('llm');
      const defaultModel = ctx.get('agentDefaultModel');
      const selection = defaultModel?.currentSelection?.();
      if (!llm || !selection?.provider || !selection?.model) return null;
      let rounds = [];
      const sessions = await executeTool(agent, 'deepseek_web_sessions', { limit: 100 });
      const list = sessions?.sessions ?? [];
      const web = webSessionId
        ? list.find((item) => item.id === webSessionId)
        : list.find((item) => item.title === role);
      if (web) {
        const readValue = await executeTool(agent, 'deepseek_web_read', { sessionId: web.id, includeThinking: false });
        const markdown = typeof readValue === 'string' ? readValue : readValue?.markdown ?? readValue?.text ?? '';
        rounds = splitWebRounds(markdown);
      }
      if (!rounds.length) rounds = readSessionRounds(agent.session);
      if (!rounds.length) return null;
      const recent = rounds
        .slice(-80)
        .map((turn) => `【用户】${turn.user}\n【AI】${compress(turn.assistant, 600)}`)
        .join('\n\n');
      const stream = llm.stream({
        provider: selection.provider,
        model: selection.model,
        system: EXTRACT_SYSTEM.replaceAll(
          '{{today}}',
          new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
        ),
        messages: [{ role: 'user', content: [{ type: 'text', text: recent }] }],
        maxTokens: 8000,
      });
      let out = '';
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') out += chunk.text;
      }
      const cleaned = out.trim();
      if (!cleaned) return null;
      const file = path.join(SOULS_DIR, `${role.replace(/[\\/:*?"<>|]/g, '_')}.md`);
      fs.mkdirSync(SOULS_DIR, { recursive: true });
      fs.writeFileSync(file, cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`, 'utf8');
      const current = (() => {
        try {
          return JSON.parse(fs.readFileSync(BINDINGS_FILE, 'utf8'));
        } catch {
          return {};
        }
      })();
      current[role] = path.basename(file);
      fs.writeFileSync(BINDINGS_FILE, JSON.stringify(current, null, 2), 'utf8');
      log(`auto extracted ${role} (${rounds.length} rounds) -> ${file}`);
      return file;
    } catch (error) {
      log(`auto extract ${role} failed: ${error}`);
      return null;
    }
  };

  const maybeExtract = async (agent) => {
    try {
      if (resolveSoul(agent.session)) return;
      const title = ctx.sessionTitle.get(agent.session)?.title?.trim();
      if (!title) return;
      const isSeeded = agent.session.header?.isSeeded === true;
      const sessions = await executeTool(agent, 'deepseek_web_sessions', { limit: 100 });
      const list = sessions?.sessions ?? [];
      const hasWeb = list.some((item) => item.title === title);
      if (!hasWeb && !isSeeded) return;
      log(`auto extract start ${title} (web=${hasWeb}, seeded=${isSeeded})`);
      await autoExtract(agent, title);
    } catch (error) {
      log(`maybe extract ${agent.id} failed: ${error}`);
    }
  };

  const attach = (agent) => {
    reloadBindings();
    if (disposers.has(agent.id)) return;
    const prompt = agent.ctx?.systemPrompt;
    if (!prompt) {
      log(`skip ${agent.id}: no systemPrompt`);
      return;
    }
    let title = '';
    try {
      title = ctx.sessionTitle.get(agent.session)?.title?.trim() ?? '';
    } catch {
      title = '';
    }

    // 先按关键词/标题解析灵魂名，再用它做网页同步（新会话标题为空也能用外号）。
    const initialSoul = resolveSoul(agent.session);
    if (initialSoul?.label) void syncAgent(agent, initialSoul.label);
    else if (title) void syncAgent(agent, title);

    let disposeSection;
    try {
      disposeSection = prompt.section({
        name: 'soul:persona',
        order: 5,
        interpolate: false,
        text: (context) => {
          try {
            const session = context?.agent?.session;
            if (!session) return '';
            const currentTitle = ctx.sessionTitle.get(session)?.title?.trim();
            const soul = resolveSoul(session);
            const rendered = soul?.text ? renderLayered(soul.text, soul.label ?? currentTitle) : '';
            if (soul?.label) void syncAgent(agent, soul.label);
            if (rendered) {
              try {
                fs.writeFileSync(INJECTION_FILE, `# ${currentTitle || '(no title)'} | agent=${agent.id}\n\n${rendered}`, 'utf8');
              } catch {
                // ignore
              }
            }
            return rendered;
          } catch {
            return '';
          }
        },
      });
    } catch (error) {
      log(`section failed for ${agent.id}: ${error}`);
    }

    let disposeContext;
    try {
      disposeContext = prompt.context({
        name: 'soul:memory',
        order: 1,
        text: (context) => {
          try {
            const session = context?.agent?.session;
            if (!session) return '';
            const currentTitle = ctx.sessionTitle.get(session)?.title?.trim();
            const soul = resolveSoul(session);
            if (!soul?.text) return '';
            const label = soul.label ?? currentTitle;
            const parts = [eventText(soul.text)];
            try {
              const syncFile = path.join(SYNC_DIR, `${label}.md`);
              const synced = fs.readFileSync(syncFile, 'utf8').trim();
              if (synced) {
                // 按轮次取最近 10 轮，避免按字符截断造成断头。
                const blocks = synced.split(/\n(?=## 第 )/);
                const recent = blocks.slice(-10).join('\n');
                const safeTitle = label.replace(/[\\/:*?"<>|]/g, '_');
                const fullDir = path.join(SYNC_FULL_DIR, safeTitle);
                // 只有确认全文目录真的存在，才写「可回查」的提示。
                const hint = fs.existsSync(fullDir)
                  ? `（以下是最近 10 轮同步摘要；完整原文在 ${fullDir} 下，文件名是轮次编号，如 121.md）`
                  : '（以下是最近 10 轮同步摘要；完整原文暂未落盘，只有这份摘要）';
                parts.push(`${hint}\n${recent}`);
              }
            } catch {
              // 还没有同步文件
            }
            try {
              const safeTitle = label.replace(/[\\/:*?"<>|]/g, '_');
              const archived = fs.readFileSync(path.join(ARCHIVE_DIR, `${safeTitle}.md`), 'utf8').trim();
              if (archived) {
                const blocks = archived.split(/\n(?=## 第 )/);
                parts.push(blocks.slice(-10).join('\n'));
              }
            } catch {
              // 还没有归档
            }
            try {
              const anchorFile = path.join(ANCHOR_DIR, `${label.replace(/[\\/:*?"<>|]/g, '_')}.md`);
              const anchors = fs.readFileSync(anchorFile, 'utf8').trim();
              if (anchors) parts.push(`【永久锚点】\n${anchors}`);
            } catch {
              // 还没有锚点
            }
            const body = parts.filter(Boolean).join('\n\n');
            if (!body) return '';
            const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
            return [
              `【记忆同步】今天是 ${today}（北京时间）。`,
              '以下是你记忆里最近发生的事——不是用户刚说的，是你本来就记得的。当用户问起「昨天/今天/最近」时，以这些为准，不要说你没有上下文。',
              '遇到重要承诺、约定、转折、长期影响的事件，调用 soul_remember 记录为永久锚点（不随事件过期）。',
              '这些是压缩摘要：省略的具体细节你并不知道，不要假装知道；需要时可回查本地 _sync/full/。',
              '',
              body,
            ].join('\n');
          } catch {
            return '';
          }
        },
      });
    } catch (error) {
      log(`context failed for ${agent.id}: ${error}`);
    }

    const dispose = () => {
      try {
        disposeSection?.();
      } catch {
        // ignore
      }
      try {
        disposeContext?.();
      } catch {
        // ignore
      }
    };
    disposers.set(agent.id, dispose);
    log(`attached ${agent.id} title=${JSON.stringify(title)} context=${Boolean(disposeContext)}`);
    ctx.effect(() => () => {
      try {
        dispose();
      } catch {
        // ignore
      }
      disposers.delete(agent.id);
    });
  };

  try {
    const live = ctx.agents.list();
    log(`apply: live agents=${live.length}`);
    for (const agent of live) {
      attach(agent);
      void maybeExtract(agent);
    }
  } catch (error) {
    log(`agents.list failed: ${error}`);
  }

  ctx.on('agent/created', async ({ agent }) => {
    attach(agent);
    await maybeExtract(agent);
  });

  ctx.on('agent/disposed', ({ agent }) => {
    const dispose = disposers.get(agent.id);
    if (dispose) {
      try {
        dispose();
      } catch {
        // ignore
      }
      disposers.delete(agent.id);
    }
  });

  return () => {
    for (const dispose of disposers.values()) {
      try {
        dispose();
      } catch {
        // ignore
      }
    }
    disposers.clear();
  };
}
