import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/core/config.js';
import { VALID_ENV } from './helpers/env.js';

function problems(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

const without = (key: keyof typeof VALID_ENV): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...VALID_ENV };
  delete env[key];
  return env;
};

describe('configuration', () => {
  it('loads a valid environment and applies the documented defaults', () => {
    const config = loadConfig({ ...VALID_ENV });
    expect(config.port).toBe(3001);
    expect(config.session.ttlHours).toBe(24);
    expect(config.llm.provider).toBe('fake');
    expect(config.timezone).toBe('Europe/Chisinau');
    expect(config.upload).toMatchObject({
      hardLimitMb: 50,
      maxPages: 100,
      defaultMaxFileSizeMb: 20,
      defaultUploadsPerDay: 10,
    });
  });

  it.each(['DATABASE_URL', 'SESSION_SECRET', 'SMTP_HOST', 'SMTP_FROM'] as const)(
    'refuses to start without %s',
    (key) => {
      expect(() => loadConfig(without(key))).toThrow(ConfigError);
      expect(problems(without(key)).join('\n')).toContain(key);
    },
  );

  it('reports every missing value at once', () => {
    expect(problems({})).toHaveLength(4);
  });

  it('treats an empty required value as missing', () => {
    expect(problems({ ...VALID_ENV, SMTP_HOST: '' }).join()).toContain('SMTP_HOST');
  });

  it('rejects a session secret shorter than 32 characters', () => {
    expect(problems({ ...VALID_ENV, SESSION_SECRET: 'short' }).join()).toContain('SESSION_SECRET');
  });

  it('rejects a session longer than 24 hours (RF2)', () => {
    expect(problems({ ...VALID_ENV, SESSION_TTL_HOURS: '25' }).join()).toContain(
      'SESSION_TTL_HOURS',
    );
  });

  it('rejects a database URL that is not PostgreSQL', () => {
    expect(problems({ ...VALID_ENV, DATABASE_URL: 'mysql://x/y' }).join()).toContain(
      'DATABASE_URL',
    );
  });

  it('requires the model key and name for a real provider', () => {
    const found = problems({ ...VALID_ENV, LLM_PROVIDER: 'some-provider' }).join('\n');
    expect(found).toContain('LLM_API_KEY');
    expect(found).toContain('LLM_MODEL');
    expect(
      problems({ ...VALID_ENV, LLM_PROVIDER: 'some-provider', LLM_API_KEY: 'k', LLM_MODEL: 'm' }),
    ).toEqual([]);
  });

  it('does not allow the fake model in production', () => {
    expect(problems({ ...VALID_ENV, NODE_ENV: 'production' }).join()).toContain('LLM_PROVIDER');
  });

  it('keeps upload limits inside the RF25 range (1–50 MB, 1–50 per day)', () => {
    expect(problems({ ...VALID_ENV, DEFAULT_MAX_FILE_SIZE_MB: '51' })).not.toEqual([]);
    expect(problems({ ...VALID_ENV, DEFAULT_UPLOADS_PER_DAY: '0' })).not.toEqual([]);
    expect(
      problems({ ...VALID_ENV, UPLOAD_HARD_LIMIT_MB: '10', DEFAULT_MAX_FILE_SIZE_MB: '20' }),
    ).not.toEqual([]);
  });

  it('rejects malformed numbers and booleans', () => {
    expect(problems({ ...VALID_ENV, PORT: 'abc' })).not.toEqual([]);
    expect(problems({ ...VALID_ENV, SMTP_SECURE: 'yes' })).not.toEqual([]);
  });
});
