import { createInterface } from 'node:readline';
import { pino } from 'pino';
import { ConfigError, loadConfig, loadEnvFile } from '../core/config.js';
import { AppError } from '../core/errors.js';
import { createDatabase } from '../db/client.js';
import { createAuthService, createPendingUserFileStore } from '../modules/auth/service.js';

/**
 * Creates an administrator account (SRS 2.1.8; docs/design/auth.md, 6.4; Q21). There is no
 * other way to get one: registration always creates students.
 *
 * Usage: `npm run admin:create -- --email admin@example.com`
 *
 * The password is asked for, twice, without being shown. It is never read from the command
 * line or from the environment, where it would end up in the shell history or in a process
 * listing. For unattended use, pipe it on standard input (one line).
 */

function emailArgument(argv: string[]): string | null {
  const index = argv.indexOf('--email');
  const value = index >= 0 ? argv[index + 1] : argv.find((a) => a.startsWith('--email='))?.slice(8);
  return value && !value.startsWith('--') ? value : null;
}

/** Reads one line from the terminal with echo off. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003') return finish(new Error('cancelled')); // Ctrl+C
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else value += character;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) {
    const password = await askHidden('Parola: ');
    const again = await askHidden('Parola, din nou: ');
    if (password !== again) throw new Error('Parolele nu coincid.');
    return password;
  }
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    lines.close();
    return line;
  }
  throw new Error('Nu am primit nicio parolă la intrarea standard.');
}

async function main(): Promise<number> {
  const email = emailArgument(process.argv.slice(2));
  if (!email) {
    process.stderr.write('Utilizare: npm run admin:create -- --email <adresă>\n');
    return 2;
  }

  loadEnvFile();
  const config = loadConfig();
  // Audit lines go to standard output, like those of the server.
  const log = pino({ level: config.logLevel, base: { service: 'recap-admin-create' } });
  const db = createDatabase({ url: config.database.url, poolMax: 1 });
  try {
    const auth = createAuthService({
      config,
      db,
      log,
      sendPasswordResetEmail: async () => undefined,
      userFiles: createPendingUserFileStore(log),
    });
    const user = await auth.createAdmin({ email, password: await readPassword() });
    process.stderr.write(`Cont de administrator creat: ${user.email} (id ${user.id}).\n`);
    return 0;
  } finally {
    await db.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const details =
      error instanceof AppError && Array.isArray(error.details)
        ? ` (${(error.details as { message: string }[]).map((d) => d.message).join('; ')})`
        : '';
    const message =
      error instanceof ConfigError || error instanceof Error ? error.message : String(error);
    process.stderr.write(`Contul nu a fost creat: ${message}${details}\n`);
    process.exit(1);
  });
