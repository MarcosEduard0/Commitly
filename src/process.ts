import { spawn } from 'node:child_process';

export function run(command: string, args: string[], options: {
  cwd: string; input?: string; signal?: AbortSignal; timeout?: number; maxBytes?: number; env?: NodeJS.ProcessEnv;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('Operação cancelada.')); return; }
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let failure: Error | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    };
    const cancel = () => stop(new Error('Operação cancelada.'));
    const timer = setTimeout(() => stop(new Error('Tempo limite excedido. Ajuste commitly.timeoutSeconds ou tente novamente.')), options.timeout ?? 15000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxBytes ?? 2000000)) stop(new Error('A saída excedeu o limite permitido. Reduza o staging ou ajuste commitly.maxDiffBytes.'));
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.stdin.on('error', () => { /* Processo pode encerrar antes de consumir o prompt. */ });
    child.on('error', error => { failure = new Error(`Não foi possível executar ${command}: ${error.message}`); });
    child.on('close', code => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Processo terminou com código ${code}. ${stderr.trim()}`));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    });
    child.stdin.end(options.input ?? '');
  });
}
