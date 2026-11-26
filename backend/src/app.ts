import fastifyMultipart from '@fastify/multipart';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Config } from './core/config.js';
import { registerErrorHandling } from './core/error-handler.js';
import { healthRoutes } from './core/health.js';
import { requireDeclaredAccess } from './core/http.js';
import { loggerOptions } from './core/logger.js';
import type { LogStream } from './core/logger.js';
import { API_PREFIX, registerOpenApi } from './core/openapi.js';
import type { Database } from './db/client.js';
import { adminRouter } from './modules/admin/router.js';
import { analysisRouter } from './modules/analysis/router.js';
import { authRouter } from './modules/auth/router.js';
import { createAuthService, registerAuthHooks } from './modules/auth/service.js';
import type { SendPasswordResetEmail, UserFileStore } from './modules/auth/service.js';
import { contentRouter } from './modules/content/router.js';
import { documentsRouter } from './modules/documents/router.js';
import { createDocumentsService } from './modules/documents/service.js';
import type {
  AnalyseDocument,
  PdfPageCounter,
  TextExtractor,
} from './modules/documents/service.js';
import { createLlmClient } from './modules/llm/service.js';
import type { LLMClient } from './modules/llm/service.js';
import { masteryRouter } from './modules/mastery/router.js';
import { remindersRouter } from './modules/reminders/router.js';
import { createPasswordResetSender } from './modules/reminders/service.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Database;
    llm: LLMClient;
  }
}

export interface AppDependencies {
  config: Config;
  db: Database;
  /** Override in tests; defaults to the client selected by LLM_PROVIDER. */
  llm?: LLMClient;
  /**
   * Sends the password-reset e-mail. Defaults to the reminders module's sender
   * (`createPasswordResetSender`). Tests pass a function that records the messages.
   */
  sendPasswordResetEmail?: SendPasswordResetEmail;
  /** Removes a deleted account's uploaded files. Defaults to the documents service's (Q43). */
  userFiles?: UserFileStore;
  /**
   * Concept extraction for a stored document (Segment 3). Defaults to an analysis that does
   * nothing. Segment 2B wires it into the documents service; tests pass a controllable fake.
   */
  analyseDocument?: AnalyseDocument;
  /** Reads the text of uploaded files. Defaults to the extractor for PDF, DOCX and TXT. */
  textExtractor?: TextExtractor;
  /** Counts the pages of a PDF at upload. Defaults to the one that reads the page tree in a thread. */
  pdfPageCounter?: PdfPageCounter;
  /** Receives every log line; lets tests check what is and is not logged. */
  logStream?: LogStream;
}

/**
 * Builds the HTTP application. No side effects besides registering plugins: it does not read
 * `process.env`, open sockets or connect to anything, so tests can build as many as they need.
 */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(deps.config, deps.logStream),
    genReqId: () => crypto.randomUUID(),
    // The client address used by the per-IP rate limit (docs/design/auth.md, 3.3).
    trustProxy: deps.config.trustProxy,
    bodyLimit: 1024 * 1024, // JSON bodies; file uploads are limited by the multipart plugin
  });

  app.decorate('config', deps.config);
  app.decorate('db', deps.db);
  app.decorate('llm', deps.llm ?? createLlmClient(deps.config));
  app.decorate(
    'documents',
    createDocumentsService({
      config: deps.config,
      db: deps.db,
      log: app.log,
      ...(deps.analyseDocument ? { analyseDocument: deps.analyseDocument } : {}),
      ...(deps.textExtractor ? { textExtractor: deps.textExtractor } : {}),
      ...(deps.pdfPageCounter ? { pdfPageCounter: deps.pdfPageCounter } : {}),
    }),
  );
  // auth imports no other module: what it needs from them is passed in here.
  app.decorate(
    'auth',
    createAuthService({
      config: deps.config,
      db: deps.db,
      log: app.log,
      sendPasswordResetEmail:
        deps.sendPasswordResetEmail ??
        createPasswordResetSender({ config: deps.config, log: app.log }),
      userFiles: deps.userFiles ?? app.documents.userFiles,
    }),
  );

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  await app.register(fastifyMultipart, {
    limits: { fileSize: deps.config.upload.hardLimitMb * 1024 * 1024, files: 1 },
  });
  await registerOpenApi(app, deps.config);

  await app.register(healthRoutes);
  await app.register(
    async (api) => {
      requireDeclaredAccess(api);
      // The one place where sessions and roles are checked (docs/design/auth.md, 6.1).
      registerAuthHooks(api, app.auth);
      await api.register(healthRoutes);
      await api.register(authRouter);
      await api.register(documentsRouter);
      await api.register(analysisRouter);
      await api.register(contentRouter);
      await api.register(masteryRouter);
      await api.register(remindersRouter);
      await api.register(adminRouter);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
