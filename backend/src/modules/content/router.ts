import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Source } from '../../core/api-schemas.js';
import { endpoint, notImplemented } from '../../core/http.js';
import {
  AnswerFeedback,
  AnswerRequest,
  GenerateMaterialsRequest,
  GenerateMaterialsResponse,
  Material,
  MaterialList,
  MaterialListQuery,
  MaterialParams,
  Report,
  ReportCreate,
  TestConfig,
  TestDetail,
  TestList,
  TestListQuery,
  TestParams,
  TestResult,
} from './schemas.js';

const tag = 'content';

/** Segment 4 — UC-06 (materials), UC-07 (tests), UC-08 (reports); uses UC-17. */
export const contentRouter: FastifyPluginAsyncZod = async (app) => {
  // --- materials --------------------------------------------------------------------------

  app.route({
    method: 'POST',
    url: '/materials/generate',
    ...endpoint(
      {
        uc: ['UC-06', 'UC-17'],
        operationId: 'generateMaterials',
        summary: 'Generate review materials for concepts of a document',
        description:
          'RF10, EV6, rules R1–R5. Synchronous: answers when generation and verification are done. Only verified materials are saved and returned (RB1, C-15). Errors: `DOCUMENT_NOT_READY` (409), `LLM_UNAVAILABLE` (M07, 503, after 2 retries — nothing is changed, C-14).',
        tag,
        auth: 'student',
        errors: [404, 409, 503],
      },
      { body: GenerateMaterialsRequest, response: { 201: GenerateMaterialsResponse } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/materials',
    ...endpoint(
      {
        uc: ['UC-06'],
        operationId: 'listMaterials',
        summary: 'List own materials, filterable',
        tag,
        auth: 'student',
      },
      { querystring: MaterialListQuery, response: { 200: MaterialList } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/materials/:material_id',
    ...endpoint(
      {
        uc: ['UC-06'],
        operationId: 'getMaterial',
        summary: 'Read a material',
        tag,
        auth: 'student',
        errors: [404],
      },
      { params: MaterialParams, response: { 200: Material } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/materials/:material_id/source',
    ...endpoint(
      {
        uc: ['UC-06', 'UC-17'],
        operationId: 'getMaterialSource',
        summary: 'The verified source passage of a material („Sursă” button)',
        description: 'RF5, RF9, RF10. Errors: `SOURCE_NOT_VERIFIED` (M09).',
        tag,
        auth: 'student',
        errors: [404, 422],
      },
      { params: MaterialParams, response: { 200: Source } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/materials/:material_id/regenerate',
    ...endpoint(
      {
        uc: ['UC-06', 'UC-17'],
        operationId: 'regenerateMaterial',
        summary: 'Ask for a new variant of a material',
        description: 'RF10 („poate cere o variantă nouă”). Same rules and errors as generation.',
        tag,
        auth: 'student',
        errors: [404, 409, 503],
      },
      { params: MaterialParams, response: { 201: Material } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/materials/:material_id/reports',
    ...endpoint(
      {
        uc: ['UC-08'],
        operationId: 'reportMaterial',
        summary: 'Report a material or question as wrong',
        description:
          'RF10, RF12, EV13, C-19. The material becomes `reported`. Errors: `MATERIAL_ALREADY_REPORTED` (a student reports a material once).',
        tag,
        auth: 'student',
        errors: [404, 409],
      },
      { params: MaterialParams, body: ReportCreate, response: { 201: Report } },
    ),
    handler: notImplemented,
  });

  // --- tests ------------------------------------------------------------------------------

  app.route({
    method: 'POST',
    url: '/tests',
    ...endpoint(
      {
        uc: ['UC-07'],
        operationId: 'createTest',
        summary: 'Configure and start a test',
        description:
          'RF11, RF12. Questions come from verified materials; missing ones are generated. Errors: `NOT_ENOUGH_MATERIALS` (409), `LLM_UNAVAILABLE` (M07, 503 — D10, back to the configuration).',
        tag,
        auth: 'student',
        errors: [404, 409, 503],
      },
      { body: TestConfig, response: { 201: TestDetail } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/tests',
    ...endpoint(
      {
        uc: ['UC-07'],
        operationId: 'listTests',
        summary: 'List own tests, newest first',
        tag,
        auth: 'student',
      },
      { querystring: TestListQuery, response: { 200: TestList } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/tests/:test_id',
    ...endpoint(
      {
        uc: ['UC-07'],
        operationId: 'getTest',
        summary: 'Read a test with its questions (to resume it)',
        tag,
        auth: 'student',
        errors: [404],
      },
      { params: TestParams, response: { 200: TestDetail } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/tests/:test_id/answers',
    ...endpoint(
      {
        uc: ['UC-07'],
        operationId: 'answerTestQuestion',
        summary: 'Answer one question and get feedback',
        description:
          'RF13, EV7. Each question is answered once. Short answers are evaluated by the model; if it is unavailable the verdict is `unevaluated` (C-04). Errors: `TEST_ALREADY_FINISHED`.',
        tag,
        auth: 'student',
        errors: [404, 409],
      },
      { params: TestParams, body: AnswerRequest, response: { 201: AnswerFeedback } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/tests/:test_id/finish',
    ...endpoint(
      {
        uc: ['UC-07'],
        operationId: 'finishTest',
        summary: 'Finish the test: score it, update mastery and reviews',
        description:
          'RF13, RF14, RF16. The score is returned only when all evaluation is done (C-05). Errors: `TEST_ALREADY_FINISHED`.',
        tag,
        auth: 'student',
        errors: [404, 409],
      },
      { params: TestParams, response: { 200: TestResult } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/tests/:test_id/result',
    ...endpoint(
      {
        uc: ['UC-07'],
        operationId: 'getTestResult',
        summary: 'Result of a finished test',
        description: 'Errors: `TEST_NOT_FINISHED`.',
        tag,
        auth: 'student',
        errors: [404, 409],
      },
      { params: TestParams, response: { 200: TestResult } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/tests/:test_id/reevaluate',
    ...endpoint(
      {
        uc: ['UC-07'],
        operationId: 'reevaluateTest',
        summary: 'Evaluate again the answers left `unevaluated`',
        description: 'C-04. Errors: `TEST_NOT_FINISHED` (409), `LLM_UNAVAILABLE` (503).',
        tag,
        auth: 'student',
        errors: [404, 409, 503],
      },
      { params: TestParams, response: { 200: TestResult } },
    ),
    handler: notImplemented,
  });
};
