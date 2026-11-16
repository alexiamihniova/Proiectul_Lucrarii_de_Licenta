import { describe, expect, it } from 'vitest';
import { createPasswordResetSender } from '../src/modules/reminders/service.js';
import { testConfig } from './helpers/env.js';

const message = {
  to: 'ana@example.com',
  resetUrl: 'http://localhost:5173/reset-password?token=SECRET-TOKEN-VALUE',
  expiresAt: new Date('2026-11-16T12:00:00.000Z'),
};

function recorder() {
  const lines: { level: string; text: string }[] = [];
  const write = (level: string) => (obj: object, msg?: string) =>
    lines.push({ level, text: JSON.stringify(obj) + (msg ?? '') });
  return { lines, log: { info: write('info'), warn: write('warn') } };
}

describe('temporary password-reset sender (until Segment 8)', () => {
  it('outside production it logs the reset link so the flow can be exercised', async () => {
    const { lines, log } = recorder();
    await createPasswordResetSender({ config: testConfig(), log })(message);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe('info');
    expect(lines[0]!.text).toContain(message.resetUrl);
    expect(lines[0]!.text).toContain('DEVELOPMENT ONLY');
  });

  it('in production it sends nothing, warns, and never logs the link, the token or the address', async () => {
    const { lines, log } = recorder();
    const config = testConfig({
      NODE_ENV: 'production',
      LLM_PROVIDER: 'real',
      LLM_API_KEY: 'k',
      LLM_MODEL: 'm',
    });
    await createPasswordResetSender({ config, log })(message);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe('warn');
    const text = lines[0]!.text;
    expect(text).not.toContain('SECRET-TOKEN-VALUE');
    expect(text).not.toContain('reset-password');
    expect(text).not.toContain(message.to);
  });

  it('never throws', async () => {
    const { log } = recorder();
    await expect(
      createPasswordResetSender({ config: testConfig(), log })(message),
    ).resolves.toBeUndefined();
  });
});
