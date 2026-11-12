import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, extname, join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { run } from '../process';
import { CommitProvider, GenerationRequest } from './types';

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

// O launcher npm inicia codex.exe sem windowsHide. Resolva o binário
// diretamente para que o processo controlado pelo Commitly permaneça oculto.
export async function resolveWindowsBinary(entrypoint: string, arch = process.arch): Promise<string> {
  const target = arch === 'x64' ? 'x86_64-pc-windows-msvc' : arch === 'arm64' ? 'aarch64-pc-windows-msvc' : undefined;
  if (!target) throw new Error(`Arquitetura Windows não suportada: ${arch}.`);
  const roots: string[] = [];
  try {
    const manifest = createRequire(entrypoint).resolve(`@openai/codex-win32-${arch}/package.json`);
    roots.push(join(dirname(manifest), 'vendor'));
  } catch { /* Instalações antigas incluem vendor no pacote principal. */ }
  roots.push(join(dirname(entrypoint), '..', 'vendor'));
  for (const root of roots) {
    for (const folder of ['bin', 'codex']) {
      const binary = join(root, target, folder, 'codex.exe');
      if (await exists(binary)) return binary;
    }
  }
  throw new Error('Executável nativo do Codex não encontrado. Reinstale @openai/codex ou configure commitly.codex.path com o caminho de codex.exe.');
}

export async function resolveCodex(configured: string): Promise<{ command: string; prefix: string[]; node: boolean }> {
  const directories = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const candidates = configured ? (isAbsolute(configured) ? [configured] : directories.map(dir => join(dir, configured)))
    : directories.flatMap(dir => process.platform === 'win32'
      ? [join(dir, 'codex.exe'), join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')]
      : [join(dir, 'codex')]);
  for (const candidate of candidates) {
    let path = candidate;
    if (/\.(cmd|ps1)$/i.test(path)) path = join(dirname(path), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (!await exists(path)) continue;
    if (extname(path) === '.js') {
      if (process.platform === 'win32' && /[/\\]codex\.js$/i.test(path)) {
        return { command: await resolveWindowsBinary(path), prefix: [], node: false };
      }
      return { command: process.execPath, prefix: [path], node: true };
    }
    return { command: path, prefix: [], node: false };
  }
  throw new Error('Codex CLI não encontrado. Instale @openai/codex e faça codex login no terminal, ou configure commitly.codex.path.');
}

export class CodexProvider implements CommitProvider {
  readonly id = 'codex';
  async generate(request: GenerationRequest): Promise<string> {
    const executable = await resolveCodex(request.executable);
    const directory = await mkdtemp(join(tmpdir(), 'commitly-'));
    try {
      const schema = join(directory, 'schema.json');
      const output = join(directory, 'message.json');
      await writeFile(schema, JSON.stringify({ type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false }), 'utf8');
      const args = [...executable.prefix, 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '--output-schema', schema, '--output-last-message', output];
      if (request.model) args.push('--model', request.model);
      args.push('-');
      await run(executable.command, args, {
        cwd: directory, input: request.prompt, signal: request.signal, timeout: request.timeout,
        env: executable.node ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env
      });
      const response: unknown = JSON.parse(await readFile(output, 'utf8'));
      if (!response || typeof response !== 'object' || !('message' in response) || typeof response.message !== 'string') throw new Error('O Codex retornou uma resposta inválida.');
      return response.message;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
