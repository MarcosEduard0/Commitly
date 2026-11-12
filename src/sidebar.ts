import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolveCodex } from './providers/codex';
import { run } from './process';

export class CommitlySidebar implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private busy = false;
  private saving = false;
  constructor(private readonly context: vscode.ExtensionContext) {}

  setBusy(busy: boolean): void {
    this.busy = busy;
    void this.view?.webview.postMessage({ type: 'busy', busy });
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = randomBytes(24).toString('hex');
    const template = await readFile(vscode.Uri.joinPath(media, 'sidebar.html').fsPath, 'utf8');
    view.webview.html = template
      .replaceAll('{{cspSource}}', view.webview.cspSource)
      .replaceAll('{{nonce}}', nonce)
      .replaceAll('{{style}}', view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.css')).toString())
      .replaceAll('{{script}}', view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.js')).toString());
    const listener = view.webview.onDidReceiveMessage(async (message: unknown) => {
      try { await this.receive(message); }
      catch (error) { await view.webview.postMessage({ type: 'result', error: true, text: error instanceof Error ? error.message : String(error) }); }
    });
    const disposal = view.onDidDispose(() => { listener.dispose(); if (this.view === view) this.view = undefined; });
    this.context.subscriptions.push(listener, disposal);
  }

  private scope(value: unknown): vscode.Uri | undefined {
    if (value === 'global') return undefined;
    const folder = vscode.workspace.workspaceFolders?.find(item => item.uri.toString() === value);
    if (!folder) throw new Error('Selecione uma pasta disponível ou as configurações do usuário.');
    return folder.uri;
  }

  private async state(scope: string): Promise<void> {
    const uri = this.scope(scope);
    const config = vscode.workspace.getConfiguration('commitly', uri);
    const get = <T>(key: string, fallback: T): T => {
      if (uri) return config.get<T>(key, fallback);
      const inspected = config.inspect<T>(key);
      return inspected?.globalValue ?? inspected?.defaultValue ?? fallback;
    };
    await this.view?.webview.postMessage({
      type: 'state', scope, busy: this.busy,
      folders: (vscode.workspace.workspaceFolders ?? []).map(folder => ({ label: folder.name, value: folder.uri.toString() })),
      model: get('codex.model', ''),
      language: get<string>('language', 'pt-BR') === 'en' ? 'en' : 'pt-BR',
      extraInstructions: get<string[]>('extraInstructions', [])
    });
  }

  private async receive(value: unknown): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error('Confie neste workspace para configurar o Commitly.');
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const message = value as Record<string, unknown>;
    if (message.type === 'ready') {
      await this.state(vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? 'global');
    } else if (message.type === 'load') {
      if (typeof message.scope !== 'string') throw new Error('Destino inválido.');
      await this.state(message.scope);
    } else if (message.type === 'save') {
      if (this.saving) throw new Error('Aguarde o salvamento atual.');
      this.saving = true;
      try {
        const uri = this.scope(message.scope);
        const input = parseSidebarSettings(message);
        const config = vscode.workspace.getConfiguration('commitly', uri);
        const target = uri ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global;
        await config.update('provider', 'codex', target);
        await config.update('codex.model', input.model, target);
        await config.update('language', input.language, target);
        await config.update('extraInstructions', input.extraInstructions, target);
        await this.view?.webview.postMessage({ type: 'result', text: 'Configurações salvas. Serão usadas nas próximas gerações.' });
      } finally { this.saving = false; }
    } else if (message.type === 'check') {
      const uri = this.scope(message.scope);
      const executable = await resolveCodex(vscode.workspace.getConfiguration('commitly', uri).get<string>('codex.path', ''));
      const version = await run(executable.command, [...executable.prefix, '--version'], {
        cwd: this.context.extensionUri.fsPath, timeout: 10000,
        env: executable.node ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env
      });
      await this.view?.webview.postMessage({ type: 'result', text: `CLI disponível: ${version.trim()}. Esta verificação não testa autenticação nem acesso ao modelo.` });
    } else if (message.type === 'advanced') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'commitly');
    }
  }
}

export function parseSidebarSettings(message: Record<string, unknown>): { model: string; language: 'pt-BR' | 'en'; extraInstructions: string[] } {
  const language = message.language ?? 'pt-BR';
  if (language !== 'pt-BR' && language !== 'en') throw new Error('Selecione Português ou Inglês.');
  if (typeof message.model !== 'string' || message.model.length > 200 || /[\r\n\x00]/.test(message.model)) throw new Error('Informe um identificador de modelo válido.');
  const lines = (value: unknown): string[] => {
    if (typeof value !== 'string' || value.length > 50000 || value.includes('\0')) throw new Error('Instruções inválidas ou muito longas (máximo 50.000 caracteres).');
    return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  };
  return { model: message.model.trim(), language, extraInstructions: lines(message.extraInstructions) };
}
