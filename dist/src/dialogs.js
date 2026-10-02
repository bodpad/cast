import { createRequire } from 'node:module';
const WebSocket = createRequire(import.meta.url)('playwright-core/lib/utilsBundle').ws;
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
    socket;
    nextId = 0;
    pending = new Map();
    sessions = new Set();
    /** Targets attached once; Target.setDiscoverTargets also reports the existing ones. */
    targets = new Set();
    static async start(endpoint) {
        const guard = new DialogGuard();
        try {
            await guard.connect(endpoint);
        }
        catch {
            guard.stop();
        }
        return guard;
    }
    async connect(endpoint) {
        const version = await (await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(STEP_MS) })).json();
        const socket = new WebSocket(version.webSocketDebuggerUrl);
        this.socket = socket;
        await new Promise((resolve, reject) => {
            socket.once('open', () => resolve());
            socket.once('error', e => reject(e));
        });
        socket.once('close', () => { this.socket = undefined; });
        socket.on('message', data => this.onMessage(JSON.parse(data.toString())));
        // Tabs that Chrome is still restoring are attached as they appear.
        await this.send('Target.setDiscoverTargets', { discover: true });
        const { targetInfos } = await this.send('Target.getTargets');
        await Promise.all(targetInfos.filter(t => t.type === 'page').map(t => this.watch(t.targetId)));
    }
    stop() {
        this.socket?.close();
        this.socket = undefined;
        for (const resolve of this.pending.values())
            resolve({ error: { message: 'stopped' } });
        this.pending.clear();
    }
    async watch(targetId) {
        if (this.targets.has(targetId))
            return;
        this.targets.add(targetId);
        const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
        this.sessions.add(sessionId);
        // Page.enable reports dialogs that open from now on; a page already blocked answers nothing.
        this.send('Page.enable', {}, sessionId).catch(() => { });
        if (await this.responds(sessionId))
            return;
        await this.send('Page.reload', {}, sessionId);
    }
    async responds(sessionId) {
        const probe = this.send('Runtime.evaluate', { expression: '0' }, sessionId).then(() => true, () => true);
        return Promise.race([probe, new Promise(r => setTimeout(() => r(false), PROBE_MS))]);
    }
    onMessage(m) {
        if (m.id !== undefined) {
            this.pending.get(m.id)?.(m);
            this.pending.delete(m.id);
            return;
        }
        if (m.method === 'Target.targetCreated') {
            const info = m.params?.targetInfo;
            if (info.type === 'page')
                this.watch(info.targetId).catch(() => { });
        }
        else if (m.method === 'Page.javascriptDialogOpening' && m.sessionId && this.sessions.has(m.sessionId)) {
            this.send('Page.handleJavaScriptDialog', { accept: m.params?.type === 'alert' }, m.sessionId).catch(() => { });
        }
    }
    send(method, params = {}, sessionId) {
        const socket = this.socket;
        if (!socket)
            return Promise.reject(new Error('not connected'));
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out`));
            }, STEP_MS);
            this.pending.set(id, m => {
                clearTimeout(timer);
                if (m.error)
                    reject(new Error(m.error.message));
                else
                    resolve(m.result ?? {});
            });
            socket.send(JSON.stringify({ id, method, params, sessionId }));
        });
    }
}
