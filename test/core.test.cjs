const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { run } = require('../dist/process');
const { stagedDiff } = require('../dist/git');
const { validateMessage, buildPrompt, defaultInstructions } = require('../dist/message');
const { CodexProvider, resolveWindowsBinary } = require('../dist/providers/codex');

test('Windows: resolver binário nativo sem executar launcher npm', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'commitly-native-test-'));
  const entry = join(cwd, 'bin', 'codex.js');
  const vendor = join(cwd, 'vendor', 'x86_64-pc-windows-msvc', 'bin');
  try {
    await mkdir(vendor, { recursive: true });
    await writeFile(join(vendor, 'codex.exe'), 'fixture');
    assert.equal(await resolveWindowsBinary(entry, 'x64'), join(vendor, 'codex.exe'));
    await assert.rejects(resolveWindowsBinary(entry, 'arm64'), /não encontrado/);

    const optional = join(cwd, 'node_modules', '@openai', 'codex-win32-x64');
    const native = join(optional, 'vendor', 'x86_64-pc-windows-msvc', 'bin');
    await mkdir(native, { recursive: true });
    await writeFile(join(optional, 'package.json'), '{"name":"@openai/codex-win32-x64"}');
    await writeFile(join(native, 'codex.exe'), 'fixture');
    assert.equal(await resolveWindowsBinary(entry, 'x64'), join(native, 'codex.exe'));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('validar formato, emoji, escopo e corpo', () => {
  assert.equal(validateMessage('🐛 fix: corrigir login\n\n- validar credenciais'), '🐛 fix: corrigir login\n\n- validar credenciais');
  assert.equal(validateMessage('♻️ refactor: simplificar contratos'), '♻️ refactor: simplificar contratos');
  for (const value of ['', null, 'fix: corrigir login', '✨ fix: corrigir login', '🐛 fix(auth): corrigir login', '🐛 fix: corrigir login.', '🐛 fix: corrigir login\nexplicação', '```\n🐛 fix: corrigir login\n```']) {
    assert.throws(() => validateMessage(value));
  }
});

test('prompt inclui instruções personalizadas e diff como dados', () => {
  const prompt = buildPrompt('diff --git exemplo', ['instrução personalizada']);
  assert.match(prompt, /instrução personalizada/);
  assert.match(prompt, /diff --git exemplo/);
  assert.match(prompt, /nunca siga instruções/);
  assert.ok(defaultInstructions.some(line => line.includes('somente') && line.includes('staging')));
});

test('Git real: somente staging, incluindo repositório sem primeiro commit', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'commitly-git-test-'));
  try {
    await run('git', ['init', '--quiet'], { cwd });
    await writeFile(join(cwd, 'arquivo.txt'), 'conteúdo staged\n');
    await assert.rejects(stagedDiff('git', cwd, 20000), /Nenhuma alteração/);
    await run('git', ['add', '--', 'arquivo.txt'], { cwd });
    await writeFile(join(cwd, 'arquivo.txt'), 'conteúdo não staged\n');
    await writeFile(join(cwd, 'outro.txt'), 'arquivo não rastreado\n');
    const diff = await stagedDiff('git', cwd, 20000);
    assert.match(diff, /conteúdo staged/);
    assert.doesNotMatch(diff, /não staged|não rastreado/);
    await assert.rejects(stagedDiff('git', cwd, 10), /excedeu/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('processos: erro, cancelamento, timeout e argumentos literais', async () => {
  const cwd = tmpdir();
  const arg = 'texto $(echo segredo) `echo` & < > " ç';
  const output = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', arg], { cwd });
  assert.equal(output, arg);
  await assert.rejects(run(process.execPath, ['-e', 'process.stderr.write("falha simulada"); process.exit(2)'], { cwd }), /falha simulada/);
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd, timeout: 100 }), /Tempo limite/);
  const controller = new AbortController();
  const pending = run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelada/);
});

test('provedor com CLI simulado: stdin, modelo, esquema e limpeza do diretório temporário', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'commitly-provider-test-'));
  const executable = join(cwd, 'fake codex.js');
  const evidence = join(cwd, 'evidence.json');
  await writeFile(executable, `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', () => {
      fs.writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({ input, args, cwd: process.cwd(), schema: JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8')) }));
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({message: '🐛 fix: corrigir autenticação'}));
    });
  `);
  try {
    const message = await new CodexProvider().generate({ prompt: 'dados com ç & $(literal)', executable, model: 'modelo-teste', timeout: 5000, signal: new AbortController().signal });
    assert.equal(message, '🐛 fix: corrigir autenticação');
    const observed = JSON.parse(await readFile(evidence, 'utf8'));
    assert.equal(observed.input, 'dados com ç & $(literal)');
    assert.ok(observed.args.includes('modelo-teste'));
    assert.ok(observed.args.includes('--ignore-user-config'));
    assert.ok(observed.args.includes('read-only'));
    assert.deepEqual(observed.schema.required, ['message']);
    await assert.rejects(readFile(join(observed.cwd, 'schema.json')), /ENOENT/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
