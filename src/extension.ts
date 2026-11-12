import * as vscode from 'vscode';
import { stagedDiff } from './git';
import { buildPrompt, getCommitInstructions, validateMessage } from './message';
import { CodexProvider } from './providers/codex';
import { CommitProvider } from './providers/types';
import { CommitlySidebar } from './sidebar';

interface Repository { rootUri: vscode.Uri; inputBox: { value: string }; }
interface GitAPI { repositories: Repository[]; git: { path: string }; }
interface GitExtension { getAPI(version: 1): GitAPI; }

export function activate(context: vscode.ExtensionContext): void {
  const providers = new Map<string, CommitProvider>([['codex', new CodexProvider()]]);
  const sidebar = new CommitlySidebar(context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('commitly.configuration', sidebar));
  let busy = false;
  const activeControllers = new Set<AbortController>();
  context.subscriptions.push({ dispose: () => { for (const controller of activeControllers) controller.abort(); } });

  async function generate(source?: { rootUri?: vscode.Uri }, askForInstruction = false): Promise<void> {
    if (busy) { void vscode.window.showInformationMessage('O Commitly já está gerando uma mensagem.'); return; }
    if (!vscode.workspace.isTrusted) return;
    busy = true;
    try {
      const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (!extension) throw new Error('Ative a extensão Git do VS Code.');
      const api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);
      let repository = source?.rootUri ? api.repositories.find(repo => repo.rootUri.toString() === source.rootUri!.toString()) : undefined;
      if (!repository && api.repositories.length === 1) repository = api.repositories[0];
      if (!repository && api.repositories.length > 1) {
        const item = await vscode.window.showQuickPick(api.repositories.map(repo => ({ label: vscode.workspace.asRelativePath(repo.rootUri), description: repo.rootUri.fsPath, repository: repo })), { placeHolder: 'Escolha o repositório para gerar o commit' });
        repository = item?.repository;
        if (!repository) return;
      }
      if (!repository) throw new Error('Abra uma pasta com um repositório Git.');
      const repo = repository;
      const initialMessage = repo.inputBox.value;
      if (initialMessage.trim()) {
        const choice = await vscode.window.showWarningMessage('Substituir a mensagem de commit atual pela nova sugestão?', { modal: true }, 'Gerar e substituir');
        if (!choice) return;
      }
      const config = vscode.workspace.getConfiguration('commitly', repo.rootUri);
      const provider = providers.get(config.get<string>('provider', 'codex'));
      if (!provider) throw new Error('Integração não disponível.');
      const maxBytes = config.get<number>('maxDiffBytes', 200000);
      const extraInstructions = config.get<string[]>('extraInstructions', []);
      let temporaryInstruction: string | undefined;
      if (askForInstruction) {
        temporaryInstruction = await vscode.window.showInputBox({
          title: 'Instrução para este commit',
          prompt: 'Acrescente uma orientação somente para esta geração. Não será salva.',
          placeHolder: 'Ex.: destacar a correção da validação de credenciais',
          validateInput: value => value.trim() ? undefined : 'Informe uma orientação ou pressione Escape para cancelar.'
        });
        if (temporaryInstruction === undefined) return;
      }
      const controller = new AbortController();
      activeControllers.add(controller);
      try {
        await vscode.commands.executeCommand('setContext', 'commitly.generating', true);
        sidebar.setBusy(true);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Commitly: gerando mensagem com Codex CLI', cancellable: false }, async (_progress, token) => {
          const subscription = token.onCancellationRequested(() => controller.abort());
          if (token.isCancellationRequested) controller.abort();
          try {
            const diff = await stagedDiff(api.git.path, repo.rootUri.fsPath, maxBytes, controller.signal);
            const message = validateMessage(await provider.generate({
              prompt: buildPrompt(diff, getCommitInstructions(config.get<string>('language', 'pt-BR')), [...extraInstructions, ...(temporaryInstruction ? [temporaryInstruction] : [])]),
              executable: config.get<string>('codex.path', ''), model: config.get<string>('codex.model', ''),
              timeout: config.get<number>('timeoutSeconds', 120) * 1000, signal: controller.signal
            }));
            const currentDiff = await stagedDiff(api.git.path, repo.rootUri.fsPath, maxBytes, controller.signal);
            if (diff !== currentDiff) throw new Error('O staging mudou durante a geração. Gere novamente para usar as alterações atuais.');
            if (repo.inputBox.value !== initialMessage) throw new Error('A mensagem foi editada durante a geração e foi preservada. Gere novamente quando terminar a edição.');
            if (controller.signal.aborted) return;
            repo.inputBox.value = message;
            if ([...message.split('\n')[0]].length > 72) void vscode.window.showInformationMessage('Mensagem gerada. O título ultrapassa 72 caracteres; revise antes de commitar.');
          } finally { subscription.dispose(); }
        });
      } finally { activeControllers.delete(controller); }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'Operação cancelada.') return;
      const action = await vscode.window.showErrorMessage(`Commitly: ${message}`, 'Configurações');
      if (action) await vscode.commands.executeCommand('commitly.settings');
    } finally {
      busy = false;
      sidebar.setBusy(false);
      await vscode.commands.executeCommand('setContext', 'commitly.generating', false);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('commitly.generate', generate),
    vscode.commands.registerCommand('commitly.regenerate', generate),
    vscode.commands.registerCommand('commitly.generateWithInstructions', (source?: { rootUri?: vscode.Uri }) => generate(source, true)),
    vscode.commands.registerCommand('commitly.cancel', () => {
      for (const controller of activeControllers) controller.abort();
    }),
    vscode.commands.registerCommand('commitly.settings', () => vscode.commands.executeCommand('commitly.configuration.focus'))
  );
}
