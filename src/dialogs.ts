import { createRequire } from 'node:module';

/** The `ws` client Playwright bundles (Node 20 has no WebSocket without a flag). */
interface Socket {
  on(event: 'message', listener: (data: Buffer) => void): void;
  once(event: 'open' | 'error' | 'close', listener: (arg?: unknown) => void): void;
  send(data: string): void;
  close(): void;
}
const WebSocket = (createRequire(import.meta.url)('playwright-core/lib/utilsBundle') as { ws: new (url: string) => Socket }).ws;

interface Message {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
  sessionId?: string;
}

/** How long a page may take to answer before it counts as blocked by a dialog. */
const PROBE_MS = 1000;
const STEP_MS = 5000;

/**
 * Closes JavaScript dialogs in Chrome's tabs while Playwright MCP attaches. A restored tab whose page
 * opens alert() or confirm() as it loads blocks its renderer, and Playwright waits for every page
 * when it attaches, so the profile never opened. Such a dialog opened before any debugger listened and
 * cannot be closed through CDP ("No dialog is showing"); reloading the tab from the browser closes it,
 * and the dialog the reload brings is reported to this session and answered: an alert is accepted,
 * confirm() and prompt() are cancelled. Dialogs that open until `stop()` are answered the same way.
 * Best effort: any failure leaves the tabs as they are.
 */
export class DialogGuard {
  private socket?: Socket;
  private nextId = 0;
  private readonly pending = new Map<number, (m: Message) => void>();
  private readonly sessions = new Set<string>();
  /** Targets attached once; Target.setDiscoverTargets also reports the existing ones. */
  private readonly targets = new Set<string>();

  static async start(endpoint: string): Promise<DialogGuard> {
    const guard = new DialogGuard();
    try {
      await guard.connect(endpoint);
    } catch {
      guard.stop();
    }
    return guard;
  }

  private async connect(endpoint: string): Promise<void> {
    const version = await (await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(STEP_MS) })).json() as { webSocketDebuggerUrl: string };
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', e => reject(e));
    });
    socket.once('close', () => { this.socket = undefined; });
    socket.on('message', data => this.onMessage(JSON.parse(data.toString()) as Message));
    // Tabs that Chrome is still restoring are attached as they appear.
    await this.send('Target.setDiscoverTargets', { discover: true });
    const { targetInfos } = await this.send('Target.getTargets') as { targetInfos: { targetId: string; type: string }[] };
    await Promise.all(targetInfos.filter(t => t.type === 'page').map(t => this.watch(t.targetId)));
  }

  stop(): void {
    this.socket?.close();
    this.socket = undefined;
    for (const resolve of this.pending.values()) resolve({ error: { message: 'stopped' } });
    this.pending.clear();
  }

  private async watch(targetId: string): Promise<void> {
    if (this.targets.has(targetId)) return;
    this.targets.add(targetId);
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
    this.sessions.add(sessionId);
    // Page.enable reports dialogs that open from now on; a page already blocked answers nothing.
    this.send('Page.enable', {}, sessionId).catch(() => {});
    if (await this.responds(sessionId)) return;
    await this.send('Page.reload', {}, sessionId);
  }

  private async responds(sessionId: string): Promise<boolean> {
    const probe = this.send('Runtime.evaluate', { expression: '0' }, sessionId).then(() => true, () => true);
    return Promise.race([probe, new Promise<boolean>(r => setTimeout(() => r(false), PROBE_MS))]);
  }

  private onMessage(m: Message): void {
    if (m.id !== undefined) {
      this.pending.get(m.id)?.(m);
      this.pending.delete(m.id);
      return;
    }
    if (m.method === 'Target.targetCreated') {
      const info = m.params?.targetInfo as { targetId: string; type: string };
      if (info.type === 'page') this.watch(info.targetId).catch(() => {});
    } else if (m.method === 'Page.javascriptDialogOpening' && m.sessionId && this.sessions.has(m.sessionId)) {
      this.send('Page.handleJavaScriptDialog', { accept: m.params?.type === 'alert' }, m.sessionId).catch(() => {});
    }
  }

  private send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('not connected'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, STEP_MS);
      this.pending.set(id, m => {
        clearTimeout(timer);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result ?? {});
      });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}
