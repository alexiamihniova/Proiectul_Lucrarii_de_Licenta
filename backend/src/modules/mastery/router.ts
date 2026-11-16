import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { endpoint, notImplemented } from '../../core/http.js';
import {
  ConceptProgressList,
  ConceptProgressQuery,
  HistoryQuery,
  ProgressHistory,
  ProgressRadar,
  ProgressSummary,
  ReviewAnswerRequest,
  ReviewAnswerResponse,
  ReviewQueue,
  ReviewSession,
  ReviewSessionQuery,
  SubjectScopeQuery,
} from './schemas.js';

const tag = 'mastery';

/** Segment 5 — UC-09 „Vizualizează progresul”, UC-10 „Recapitulează conceptele scadente”. */
export const masteryRouter: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: 'GET',
    url: '/progress/concepts',
    ...endpoint(
      {
        uc: ['UC-09'],
        operationId: 'listConceptProgress',
        summary: 'Mastery and status of each concept',
        description: 'RF14.',
        tag,
        auth: 'student',
      },
      { querystring: ConceptProgressQuery, response: { 200: ConceptProgressList } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/progress/summary',
    ...endpoint(
      {
        uc: ['UC-09'],
        operationId: 'getProgressSummary',
        summary: 'Counts by status, coverage, streak, daily goal',
        description: 'RF15.',
        tag,
        auth: 'student',
      },
      { querystring: SubjectScopeQuery, response: { 200: ProgressSummary } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/progress/radar',
    ...endpoint(
      {
        uc: ['UC-09'],
        operationId: 'getProgressRadar',
        summary: 'Data for the radar chart of concepts',
        description: 'RF15.',
        tag,
        auth: 'student',
      },
      { querystring: SubjectScopeQuery, response: { 200: ProgressRadar } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/progress/history',
    ...endpoint(
      {
        uc: ['UC-09'],
        operationId: 'getProgressHistory',
        summary: 'Daily evolution of mastery (last 30 days)',
        description: 'RF15.',
        tag,
        auth: 'student',
      },
      { querystring: HistoryQuery, response: { 200: ProgressHistory } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/reviews/today',
    ...endpoint(
      {
        uc: ['UC-10'],
        operationId: 'getReviewQueue',
        summary: 'Concepts due for review today',
        description: 'RF16, EV9. A concept is due when its next review date is today or earlier.',
        tag,
        auth: 'student',
      },
      { querystring: SubjectScopeQuery, response: { 200: ReviewQueue } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/reviews/session',
    ...endpoint(
      {
        uc: ['UC-10'],
        operationId: 'getReviewSession',
        summary: 'Cards for a review session: due flashcards and questions, mixed',
        description: 'RF16. Only verified, valid materials are used (RB1).',
        tag,
        auth: 'student',
      },
      { querystring: ReviewSessionQuery, response: { 200: ReviewSession } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/reviews/answers',
    ...endpoint(
      {
        uc: ['UC-10'],
        operationId: 'answerReview',
        summary: 'Rate a review card; updates mastery and the SM-2 schedule',
        description: 'RF14, RF16, EV7.',
        tag,
        auth: 'student',
        errors: [404],
      },
      { body: ReviewAnswerRequest, response: { 201: ReviewAnswerResponse } },
    ),
    handler: notImplemented,
  });
};
