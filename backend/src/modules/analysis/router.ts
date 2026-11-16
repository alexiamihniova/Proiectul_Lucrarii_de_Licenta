import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { NoContent, endpoint, notImplemented } from '../../core/http.js';
import {
  ConceptCreate,
  ConceptDetail,
  ConceptList,
  ConceptListQuery,
  ConceptMerge,
  ConceptParams,
  ConceptUpdate,
} from './schemas.js';

const tag = 'analysis';

/**
 * Segment 3 — UC-05 „Gestionează conceptele” (RF8) and the visible side of UC-17 „Verifică
 * sursele” (RF9). Concept extraction itself (RF7) has no route: it is part of the background
 * analysis started by the upload (UC-04).
 */
export const analysisRouter: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: 'GET',
    url: '/concepts',
    ...endpoint(
      {
        uc: ['UC-05'],
        operationId: 'listConcepts',
        summary: 'List concepts of a subject or a document',
        tag,
        auth: 'student',
      },
      { querystring: ConceptListQuery, response: { 200: ConceptList } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/concepts',
    ...endpoint(
      {
        uc: ['UC-05', 'UC-17'],
        operationId: 'createConcept',
        summary: 'Add a concept manually',
        description:
          'RF8. The server checks that every passage belongs to one document of the student (RF9).',
        tag,
        auth: 'student',
        errors: [404, 409],
      },
      { body: ConceptCreate, response: { 201: ConceptDetail } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/concepts/:concept_id',
    ...endpoint(
      {
        uc: ['UC-05', 'UC-17'],
        operationId: 'getConcept',
        summary: 'Read a concept with its verified source passages',
        tag,
        auth: 'student',
        errors: [404],
      },
      { params: ConceptParams, response: { 200: ConceptDetail } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'PATCH',
    url: '/concepts/:concept_id',
    ...endpoint(
      {
        uc: ['UC-05'],
        operationId: 'updateConcept',
        summary: 'Rename a concept or edit its definition',
        tag,
        auth: 'student',
        errors: [404],
      },
      { params: ConceptParams, body: ConceptUpdate, response: { 200: ConceptDetail } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'DELETE',
    url: '/concepts/:concept_id',
    ...endpoint(
      {
        uc: ['UC-05'],
        operationId: 'deleteConcept',
        summary: 'Delete a concept with its materials and progress',
        tag,
        auth: 'student',
        errors: [404],
      },
      { params: ConceptParams, response: { 204: NoContent } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/concepts/:concept_id/merge',
    ...endpoint(
      {
        uc: ['UC-05'],
        operationId: 'mergeConcepts',
        summary: 'Merge another concept into this one',
        description:
          'RF8. Errors: `CONCEPTS_IN_DIFFERENT_DOCUMENTS` when the two concepts are not from the same document (C-22).',
        tag,
        auth: 'student',
        errors: [404, 409],
      },
      { params: ConceptParams, body: ConceptMerge, response: { 200: ConceptDetail } },
    ),
    handler: notImplemented,
  });
};
