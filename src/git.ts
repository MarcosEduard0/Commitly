import { run } from './process';

export async function stagedDiff(git: string, cwd: string, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const diff = await run(git, ['-c', 'core.quotePath=false', 'diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', '--'], {
    cwd, maxBytes, signal, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  });
  if (!diff.trim()) throw new Error('Nenhuma alteração em staging. Adicione os arquivos desejados antes de gerar o commit.');
  return diff;
}
