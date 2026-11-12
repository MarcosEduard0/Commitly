const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

async function scenario(change) {
  const errors = [];
  const commands = new Map();
  const contexts = [];
  const repository = { rootUri: { toString: () => 'file:///repo', fsPath: '/repo' }, inputBox: { value: '' } };
  let reads = 0;
  let capturedPrompt;
  const vscode = {
    workspace: { isTrusted: true, getConfiguration: () => ({ get: (key, fallback) => {
      if (key === 'instructions') return ['substituição antiga que deve ser ignorada'];
      if (key === 'language' && change === 'english') return 'en';
      return change === 'extra' && key === 'extraInstructions' ? ['orientação persistente'] : fallback;
    } }) },
    extensions: { getExtension: () => ({ isActive: true, exports: { getAPI: () => ({ git: { path: 'git' }, repositories: [repository] }) } }) },
    commands: {
      registerCommand: (name, fn) => { commands.set(name, fn); return { dispose() {} }; },
      executeCommand: async (...args) => contexts.push(args)
    },
    ProgressLocation: { Window: 10 },
    window: {
      registerWebviewViewProvider: () => ({ dispose() {} }),
      showInputBox: async () => change === 'dismiss' ? undefined : 'orientação temporária',
      withProgress: async (options, callback) => {
        assert.equal(options.location, vscode.ProgressLocation.Window);
        assert.equal(options.cancellable, false);
        return callback({}, { onCancellationRequested: () => ({ dispose() {} }), isCancellationRequested: false });
      },
      showErrorMessage: async message => { errors.push(message); },
      showInformationMessage: async () => {},
      showWarningMessage: async () => 'Gerar e substituir'
    }
  };
  const original = Module._load;
  const entry = require.resolve('../dist/extension');
  delete require.cache[entry];
  Module._load = function (id, ...args) {
    if (id === 'vscode') return vscode;
    if (id === './sidebar') return { CommitlySidebar: class { setBusy() {} } };
    if (id === './git') return { stagedDiff: async () => { reads++; return change === 'staging' && reads > 1 ? 'diff alterado' : 'diff original'; } };
    if (id === './providers/codex') return { CodexProvider: class {
      async generate(request) {
        capturedPrompt = request.prompt;
        if (change === 'cancel') {
          commands.get('commitly.cancel')();
          assert.equal(request.signal.aborted, true);
          throw new Error('Operação cancelada.');
        }
        if (change === 'message') repository.inputBox.value = 'mensagem editada';
        return '🐛 fix: corrigir autenticação';
      }
    } };
    return original.call(this, id, ...args);
  };
  try { require(entry).activate({ subscriptions: [] }); }
  finally { Module._load = original; delete require.cache[entry]; }
  await commands.get(['extra', 'dismiss'].includes(change) ? 'commitly.generateWithInstructions' : 'commitly.generate')();
  assert.deepEqual(contexts.at(-1), ['setContext', 'commitly.generating', false]);
  return { repository, errors, capturedPrompt };
}

test('comando preenche o campo de commit', async () => {
  const { repository, errors } = await scenario();
  assert.equal(repository.inputBox.value, '🐛 fix: corrigir autenticação');
  assert.deepEqual(errors, []);
});

test('comando preserva edição feita durante a geração', async () => {
  const { repository, errors } = await scenario('message');
  assert.equal(repository.inputBox.value, 'mensagem editada');
  assert.match(errors[0], /editada durante/);
});

test('comando descarta sugestão se staging mudar', async () => {
  const { repository, errors } = await scenario('staging');
  assert.equal(repository.inputBox.value, '');
  assert.match(errors[0], /staging mudou/);
});

test('botão parar cancela a geração e restaura estado sem erro', async () => {
  const { repository, errors } = await scenario('cancel');
  assert.equal(repository.inputBox.value, '');
  assert.deepEqual(errors, []);
});

test('instruções persistentes e temporárias complementam o prompt padrão', async () => {
  const { capturedPrompt } = await scenario('extra');
  assert.match(capturedPrompt, /português brasileiro/);
  assert.match(capturedPrompt, /orientação persistente/);
  assert.match(capturedPrompt, /orientação temporária/);
  assert.doesNotMatch(capturedPrompt, /substituição antiga/);
});

test('fechar entrada de instrução adicional não gera mensagem', async () => {
  const { repository, capturedPrompt } = await scenario('dismiss');
  assert.equal(repository.inputBox.value, '');
  assert.equal(capturedPrompt, undefined);
});

test('idioma inglês seleciona regras sem exigência de português', async () => {
  const { capturedPrompt, errors } = await scenario('english');
  assert.match(capturedPrompt, /exclusively in English/);
  assert.match(capturedPrompt, /entire body in English/);
  assert.doesNotMatch(capturedPrompt, /exclusivamente em português/);
  assert.deepEqual(errors, []);
});
