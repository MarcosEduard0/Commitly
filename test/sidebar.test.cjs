const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function setup() {
  const updates = [];
  const messages = [];
  const folder = { uri: { toString: () => 'file:///projeto' }, name: 'projeto' };
  const mock = {
    workspace: {
      isTrusted: true,
      workspaceFolders: [folder],
      getConfiguration: (_section, uri) => ({
        get: (key, fallback) => key === 'codex.model' ? 'modelo-pasta' : fallback,
        inspect: key => ({ globalValue: key === 'codex.model' ? 'modelo-usuario' : undefined }),
        update: async (key, value, target) => updates.push({ key, value, target, uri })
      })
    },
    ConfigurationTarget: { Global: 1, WorkspaceFolder: 3 }
  };
  const original = Module._load;
  const path = require.resolve('../dist/sidebar');
  delete require.cache[path];
  Module._load = function (id, ...args) {
    return id === 'vscode' ? mock : original.call(this, id, ...args);
  };
  let exported;
  try { exported = require(path); }
  finally { Module._load = original; delete require.cache[path]; }
  const sidebar = new exported.CommitlySidebar({ subscriptions: [] });
  sidebar.view = { webview: { postMessage: async message => messages.push(message) } };
  return { sidebar, mock, updates, messages, parse: exported.parseSidebarSettings, folder };
}

test('painel salva apenas campos permitidos no destino escolhido', async () => {
  const { sidebar, updates, folder } = setup();
  const input = { type: 'save', scope: 'file:///projeto', model: ' modelo-teste ', instructions: ' primeira\n\n segunda ', extraInstructions: 'orientação extra', token: 'não salvar' };
  await sidebar.receive(input);
  assert.deepEqual(updates.map(item => item.key), ['provider', 'codex.model', 'language', 'extraInstructions']);
  assert.ok(updates.every(item => item.target === 3 && item.uri === folder.uri));
  assert.equal(updates[2].value, 'pt-BR');
  assert.deepEqual(updates[3].value, ['orientação extra']);
  assert.equal(updates[1].value, 'modelo-teste');
});

test('painel salva inglês, carrega português por padrão e recusa idioma não suportado', async () => {
  const { sidebar, messages, updates, parse } = setup();
  await sidebar.receive({ type: 'ready' });
  assert.equal(messages.at(-1).language, 'pt-BR');
  await sidebar.receive({ type: 'save', scope: 'global', model: '', language: 'en', extraInstructions: '' });
  assert.equal(updates.find(item => item.key === 'language').value, 'en');
  assert.throws(() => parse({ model: '', language: 'fr', extraInstructions: '' }), /Português ou Inglês/);
});

test('painel distingue usuário e pasta e recusa destino arbitrário', async () => {
  const { sidebar, messages, updates } = setup();
  await sidebar.receive({ type: 'load', scope: 'global' });
  assert.equal(messages.at(-1).model, 'modelo-usuario');
  assert.equal('instructions' in messages.at(-1), false);
  assert.equal('defaultInstructions' in messages.at(-1), false);
  await sidebar.receive({ type: 'load', scope: 'file:///projeto' });
  assert.equal(messages.at(-1).model, 'modelo-pasta');
  await assert.rejects(sidebar.receive({ type: 'save', scope: 'file:///outra-pasta', model: '', instructions: '', extraInstructions: '' }), /pasta disponível/);
  assert.equal(updates.length, 0);
  await sidebar.receive({ type: 'save', scope: 'global', model: '', instructions: '', extraInstructions: '' });
  assert.ok(updates.every(item => item.target === 1 && item.uri === undefined));
});

test('painel valida entradas antes de salvar e respeita workspace não confiável', async () => {
  const { sidebar, updates, mock, parse } = setup();
  assert.throws(() => parse({ model: 'modelo\n--flag', instructions: '', extraInstructions: '' }), /modelo válido/);
  assert.throws(() => parse({ model: '', extraInstructions: ['entrada inesperada'] }), /Instruções inválidas/);
  await assert.rejects(sidebar.receive({ type: 'save', scope: 'global', model: '', instructions: '', extraInstructions: 'x'.repeat(50001) }), /muito longas/);
  assert.equal(updates.length, 0);
  mock.workspace.isTrusted = false;
  await assert.rejects(sidebar.receive({ type: 'ready' }), /Confie neste workspace/);
});
