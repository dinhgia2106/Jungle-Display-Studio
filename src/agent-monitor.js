const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const INTERNAL_CODEX_TITLE = 'The following is the Codex agent history whose request action you are assessing';

function emptyProvider(name) {
  return { name, available: false, connected: false, error: null, quota: null };
}

function emptySnapshot() {
  return {
    updatedAt: 0,
    providers: { codex: emptyProvider('Codex'), claude: emptyProvider('Claude Code') },
    tasks: []
  };
}

function percent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number * 10) / 10)) : null;
}

function normalizeRateWindow(value) {
  if (!value || typeof value !== 'object') return null;
  const usedPercent = percent(value.usedPercent ?? value.used_percentage ?? value.utilization);
  const resetsAt = Number(value.resetsAt ?? value.resets_at);
  if (usedPercent == null && !Number.isFinite(resetsAt)) return null;
  return { usedPercent, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null };
}

function normalizeCodexQuota(response) {
  const limits = response?.rateLimits || Object.values(response?.rateLimitsByLimitId || {})[0];
  if (!limits) return null;
  return {
    plan: limits.planType || null,
    primary: normalizeRateWindow(limits.primary),
    secondary: normalizeRateWindow(limits.secondary),
    credits: limits.credits ? {
      hasCredits: Boolean(limits.credits.hasCredits),
      unlimited: Boolean(limits.credits.unlimited),
      balance: String(limits.credits.balance ?? '')
    } : null,
    resetCredits: Number(response?.rateLimitResetCredits?.availableCount) || 0
  };
}

function normalizeClaudeQuota(value) {
  const limits = value?.rate_limits || value?.rateLimits;
  if (!limits) return null;
  const fiveHour = normalizeRateWindow(limits.five_hour || limits.fiveHour);
  const sevenDay = normalizeRateWindow(limits.seven_day || limits.sevenDay);
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

function inferCodexLifecycle(text, updatedAt = Date.now(), now = Date.now()) {
  let lifecycle = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const type = event?.type === 'event_msg' ? event.payload?.type : null;
      if (['task_started', 'task_complete', 'turn_aborted'].includes(type)) lifecycle = type;
    } catch {
      // A tail read can start halfway through a JSONL record.
    }
  }
  if (lifecycle === 'task_complete') return 'completed';
  if (lifecycle === 'turn_aborted') return 'stopped';
  if (lifecycle === 'task_started') return now - Number(updatedAt || 0) < 24 * 60 * 60 * 1000 ? 'running' : 'stale';
  return 'unknown';
}

async function inferCodexLifecycleFile(filePath, updatedAt, now) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    let end = stat.size;
    let scanned = 0;
    const chunkSize = 192 * 1024;
    const maximum = 4 * 1024 * 1024;
    while (end > 0 && scanned < maximum) {
      const length = Math.min(chunkSize, end, maximum - scanned);
      const buffer = Buffer.alloc(length);
      const position = end - length;
      await handle.read(buffer, 0, length, position);
      const text = buffer.toString('utf8');
      const status = inferCodexLifecycle(text, updatedAt, now);
      if (status !== 'unknown') return status;
      const overlap = position > 0 ? Math.min(4096, length - 1) : 0;
      end = position + overlap;
      scanned += length - overlap;
    }
    return 'unknown';
  } finally {
    await handle.close();
  }
}

function taskTitle(value) {
  return String(value?.name || value?.title || value?.preview || value?.label || value?.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

async function normalizeCodexTasks(response, now = Date.now()) {
  const threads = Array.isArray(response?.data) ? response.data : [];
  const tasks = await Promise.all(threads.map(async (thread) => {
    const title = taskTitle(thread);
    if (!title || title.startsWith(INTERNAL_CODEX_TITLE)) return null;
    const updatedAt = (Number(thread.updatedAt) || Number(thread.recencyAt) || 0) * 1000;
    let status = thread.status?.type === 'active' ? 'running' : 'unknown';
    if (status !== 'running' && thread.path) {
      try {
        status = await inferCodexLifecycleFile(thread.path, updatedAt, now);
      } catch {
        // The history can move while Codex archives a thread.
      }
    }
    return { id: String(thread.id || thread.sessionId || title), provider: 'codex', title, status, updatedAt };
  }));
  return tasks.filter(Boolean);
}

function normalizedClaudeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (['running', 'active', 'in_progress', 'in-progress', 'working'].includes(status)) return 'running';
  if (['completed', 'complete', 'done', 'succeeded', 'success'].includes(status)) return 'completed';
  if (['failed', 'error', 'cancelled', 'canceled', 'stopped'].includes(status)) return 'stopped';
  return 'unknown';
}

function normalizeClaudeTasks(value) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.agents) ? value.agents : Array.isArray(value?.sessions) ? value.sessions : [];
  return rows.map((agent, index) => {
    const title = taskTitle(agent) || `Claude task ${index + 1}`;
    const timestamp = agent.updatedAt || agent.updated_at || agent.completedAt || agent.completed_at || agent.startedAt || agent.started_at;
    const parsed = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp || '');
    const updatedAt = Number.isFinite(parsed) ? (parsed < 10_000_000_000 ? parsed * 1000 : parsed) : 0;
    return {
      id: String(agent.id || agent.sessionId || agent.session_id || `claude-${index}`),
      provider: 'claude',
      title,
      status: normalizedClaudeStatus(agent.status || agent.state),
      updatedAt
    };
  });
}

function sortTasks(tasks) {
  const priority = { running: 0, stale: 1, unknown: 2, stopped: 3, completed: 4 };
  return tasks.slice().sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || b.updatedAt - a.updatedAt);
}

function recentTasks(tasks, now = Date.now(), maxPerProvider = 8, maxAgeMs = 24 * 60 * 60 * 1000) {
  const counts = new Map();
  return sortTasks(tasks).filter((task) => {
    const updatedAt = Number(task.updatedAt) || 0;
    const isRecent = task.status === 'running' || (updatedAt > 0 && now - updatedAt <= maxAgeMs);
    if (!isRecent) return false;
    const provider = String(task.provider || 'unknown');
    const count = counts.get(provider) || 0;
    if (count >= maxPerProvider) return false;
    counts.set(provider, count + 1);
    return true;
  });
}

class JsonLineRpcClient {
  constructor(executable, onNotification = () => {}) {
    this.executable = executable;
    this.onNotification = onNotification;
    this.process = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
  }

  async start() {
    if (this.process && !this.process.killed) return;
    this.process = spawn(this.executable, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.process.stdout.on('data', (chunk) => this.handleData(chunk));
    this.process.once('error', (error) => this.fail(error));
    this.process.once('exit', (code) => this.fail(new Error(`Codex app-server exited (${code ?? 'unknown'})`)));
    await this.request('initialize', {
      clientInfo: { name: 'jungle_display_studio', title: 'Jungle Display Studio', version: '1.0.0' },
      capabilities: { experimentalApi: true }
    });
    this.notify('initialized', {});
  }

  handleData(chunk) {
    this.buffer += chunk.toString('utf8');
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        if (message.id == null) {
          if (typeof message.method === 'string') this.onNotification(message);
          continue;
        }
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message || 'Codex app-server request failed'));
        else pending.resolve(message.result);
      } catch {
        // Ignore diagnostics that are not protocol messages.
      }
    }
  }

  request(method, params = {}, timeout = 12_000) {
    if (!this.process?.stdin?.writable) return Promise.reject(new Error('Codex app-server is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ method, id, params }) + '\n');
    });
  }

  notify(method, params = {}) {
    if (this.process?.stdin?.writable) this.process.stdin.write(JSON.stringify({ method, params }) + '\n');
  }

  fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.process = null;
  }

  stop() {
    if (!this.process) return;
    this.process.stdin.end();
    this.process.kill();
    this.process = null;
  }
}

async function pathCandidates(command, home = os.homedir()) {
  const candidates = [];
  const envName = `JUNGLE_${command.toUpperCase()}_PATH`;
  if (process.env[envName]) candidates.push(process.env[envName]);
  if (command === 'codex' && process.platform === 'win32') {
    const extensions = path.join(home, '.vscode', 'extensions');
    try {
      const folders = await fs.promises.readdir(extensions);
      folders.filter((name) => name.startsWith('openai.chatgpt-')).sort().reverse().forEach((name) => {
        candidates.push(path.join(extensions, name, 'bin', 'windows-x86_64', 'codex.exe'));
      });
    } catch {
      // VS Code is optional.
    }
  }
  try {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(locator, [command], { timeout: 2500, windowsHide: true });
    candidates.push(...String(stdout || '').split(/\r?\n/).filter(Boolean));
  } catch {
    // Continue with known install locations.
  }
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

async function findExecutable(command, home) {
  const candidates = await pathCandidates(command, home);
  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next installation.
    }
  }
  return null;
}

async function runClaudeAgents(executable) {
  const options = { timeout: 8000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 };
  let result;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    result = await execFileAsync('cmd.exe', ['/d', '/s', '/c', `"${executable}" agents --json --all`], options);
  } else {
    result = await execFileAsync(executable, ['agents', '--json', '--all'], options);
  }
  return JSON.parse(String(result.stdout || '[]'));
}

function bridgeScriptSource() {
  return `'use strict';\nconst fs=require('fs');\nconst target=process.argv[2];\nlet input='';\nprocess.stdin.on('data',(chunk)=>input+=chunk);\nprocess.stdin.on('end',()=>{\n  try {\n    const data=JSON.parse(input);\n    data.jungleCapturedAt=Date.now();\n    const temp=target+'.'+process.pid+'.tmp';\n    fs.mkdirSync(require('path').dirname(target),{recursive:true});\n    fs.writeFileSync(temp,JSON.stringify(data));\n    fs.renameSync(temp,target);\n    const parts=[];\n    const five=data.rate_limits?.five_hour?.used_percentage;\n    const week=data.rate_limits?.seven_day?.used_percentage;\n    if(five!=null)parts.push('5h: '+Math.round(five)+'%');\n    if(week!=null)parts.push('7d: '+Math.round(week)+'%');\n    const model=data.model?.display_name||'Claude';\n    process.stdout.write('['+model+']'+(parts.length?' | '+parts.join(' '):''));\n  } catch { process.stdout.write('[Claude]'); }\n});\n`;
}

function shellPath(value) {
  return `"${String(value).replaceAll('\\', '/').replaceAll('"', '\\"')}"`;
}

class AgentMonitor {
  constructor({ userDataPath, home = os.homedir(), disabled = false, onUpdate = () => {} } = {}) {
    this.userDataPath = userDataPath || path.join(home, '.jungle-display');
    this.home = home;
    this.disabled = disabled;
    this.onUpdate = onUpdate;
    this.snapshot = emptySnapshot();
    this.timer = null;
    this.refreshTimer = null;
    this.refreshing = null;
    this.realtimePending = false;
    this.lastRealtimeRefreshAt = 0;
    this.watchers = [];
    this.watchedDirectories = new Set();
    this.codexExecutable = undefined;
    this.claudeExecutable = undefined;
    this.codexClient = null;
    this.codexQuota = null;
    this.codexQuotaAt = 0;
    this.claudeCacheFile = path.join(this.userDataPath, 'agent-monitor', 'claude-status.json');
  }

  async start() {
    if (this.disabled) return this.snapshot;
    await this.startWatchers();
    await this.refresh();
    this.timer = setInterval(() => this.refresh().catch(() => {}), 10_000);
    return this.snapshot;
  }

  async watchDirectory(directory) {
    const resolved = path.resolve(directory);
    if (this.watchedDirectories.has(resolved)) return;
    try {
      const stat = await fs.promises.stat(resolved);
      if (!stat.isDirectory()) return;
      const recursive = process.platform === 'win32' || process.platform === 'darwin';
      const watcher = fs.watch(resolved, { recursive }, () => this.scheduleRealtimeRefresh());
      watcher.on('error', () => {});
      watcher.unref?.();
      this.watchers.push(watcher);
      this.watchedDirectories.add(resolved);
    } catch {
      // Optional provider directories may not exist yet.
    }
  }

  async startWatchers() {
    await Promise.all([
      this.watchDirectory(path.join(this.home, '.codex', 'sessions')),
      this.watchDirectory(path.join(this.home, '.codex', 'archived_sessions')),
      this.watchDirectory(path.join(this.home, '.claude')),
      this.watchDirectory(path.dirname(this.claudeCacheFile))
    ]);
  }

  scheduleRealtimeRefresh() {
    if (this.disabled) return;
    if (this.refreshing) {
      this.realtimePending = true;
      return;
    }
    if (this.refreshTimer) return;
    const delay = Math.max(75, 750 - (Date.now() - this.lastRealtimeRefreshAt));
    this.refreshTimer = setTimeout(async () => {
      this.refreshTimer = null;
      this.lastRealtimeRefreshAt = Date.now();
      try {
        await this.refresh();
      } catch {
        // The fallback interval will retry provider failures.
      } finally {
        if (this.realtimePending) {
          this.realtimePending = false;
          this.scheduleRealtimeRefresh();
        }
      }
    }, delay);
  }

  async codexSnapshot() {
    if (this.codexExecutable === undefined) this.codexExecutable = await findExecutable('codex', this.home);
    if (!this.codexExecutable) return { provider: { ...emptyProvider('Codex'), error: 'not-installed' }, tasks: [] };
    try {
      if (!this.codexClient) this.codexClient = new JsonLineRpcClient(this.codexExecutable, (message) => {
        if (/^(thread|turn|account)\//.test(message.method)) this.scheduleRealtimeRefresh();
      });
      await this.codexClient.start();
      const threadsPromise = this.codexClient.request('thread/list', { limit: 20, sortKey: 'recency_at', sortDirection: 'desc', sourceKinds: ['cli', 'vscode', 'appServer'] });
      let limits = this.codexQuota;
      if (!limits || Date.now() - this.codexQuotaAt >= 60_000) {
        try {
          limits = await this.codexClient.request('account/rateLimits/read');
          this.codexQuota = limits;
          this.codexQuotaAt = Date.now();
        } catch (error) {
          if (!limits) {
            await threadsPromise.catch(() => {});
            throw error;
          }
        }
      }
      const threads = await threadsPromise;
      return {
        provider: { name: 'Codex', available: true, connected: true, error: null, quota: normalizeCodexQuota(limits) },
        tasks: await normalizeCodexTasks(threads)
      };
    } catch (error) {
      this.codexClient?.stop();
      this.codexClient = null;
      return { provider: { name: 'Codex', available: true, connected: false, error: error.message, quota: null }, tasks: [] };
    }
  }

  async claudeSnapshot() {
    if (this.claudeExecutable === undefined) this.claudeExecutable = await findExecutable('claude', this.home);
    let cached = null;
    try {
      cached = JSON.parse(await fs.promises.readFile(this.claudeCacheFile, 'utf8'));
    } catch {
      // The bridge has not reported yet.
    }
    const quota = normalizeClaudeQuota(cached);
    if (!this.claudeExecutable) {
      return { provider: { name: 'Claude Code', available: false, connected: Boolean(quota), error: 'not-installed', quota }, tasks: [] };
    }
    try {
      const agents = await runClaudeAgents(this.claudeExecutable);
      return { provider: { name: 'Claude Code', available: true, connected: true, error: null, quota }, tasks: normalizeClaudeTasks(agents) };
    } catch (error) {
      return { provider: { name: 'Claude Code', available: true, connected: Boolean(quota), error: error.message, quota }, tasks: [] };
    }
  }

  async refresh() {
    if (this.disabled) return this.snapshot;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const [codex, claude] = await Promise.all([this.codexSnapshot(), this.claudeSnapshot()]);
      this.snapshot = {
        updatedAt: Date.now(),
        providers: { codex: codex.provider, claude: claude.provider },
        tasks: recentTasks([...codex.tasks, ...claude.tasks])
      };
      this.onUpdate(this.snapshot);
      return this.snapshot;
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
      if (this.realtimePending) {
        this.realtimePending = false;
        this.scheduleRealtimeRefresh();
      }
    }
  }

  async configureClaudeBridge() {
    const nodeExecutable = await findExecutable('node', this.home);
    if (!nodeExecutable) return { ok: false, reason: 'node-not-installed' };
    const claudeDirectory = path.join(this.home, '.claude');
    const settingsPath = path.join(claudeDirectory, 'settings.json');
    const bridgeDirectory = path.join(this.userDataPath, 'agent-monitor');
    const bridgePath = path.join(bridgeDirectory, 'claude-status-bridge.js');
    let settings = {};
    try {
      settings = JSON.parse(await fs.promises.readFile(settingsPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') return { ok: false, reason: 'invalid-settings' };
    }
    const existing = settings.statusLine?.command;
    if (existing && !String(existing).includes('claude-status-bridge.js')) return { ok: false, reason: 'existing-status-line' };
    await fs.promises.mkdir(bridgeDirectory, { recursive: true });
    await fs.promises.mkdir(claudeDirectory, { recursive: true });
    await Promise.all([this.watchDirectory(bridgeDirectory), this.watchDirectory(claudeDirectory)]);
    await fs.promises.writeFile(bridgePath, bridgeScriptSource(), 'utf8');
    if (fs.existsSync(settingsPath)) {
      const backup = path.join(claudeDirectory, `settings.jungle-backup-${Date.now()}.json`);
      await fs.promises.copyFile(settingsPath, backup);
    }
    settings.statusLine = {
      type: 'command',
      command: `${shellPath(nodeExecutable)} ${shellPath(bridgePath)} ${shellPath(this.claudeCacheFile)}`,
      refreshInterval: 5
    };
    await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return { ok: true, settingsPath };
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.refreshTimer);
    this.timer = null;
    this.refreshTimer = null;
    this.watchers.forEach((watcher) => watcher.close());
    this.watchers = [];
    this.watchedDirectories.clear();
    this.codexClient?.stop();
    this.codexClient = null;
  }
}

module.exports = {
  AgentMonitor,
  emptySnapshot,
  normalizeCodexQuota,
  normalizeClaudeQuota,
  normalizeClaudeTasks,
  inferCodexLifecycle,
  sortTasks,
  recentTasks,
  bridgeScriptSource
};
