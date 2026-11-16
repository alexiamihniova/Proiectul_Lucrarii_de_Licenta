/**
 * Public surface of the analysis module (Segment 3). Other modules import ONLY from this file.
 *
 * Segment 3 implements here:
 *  - concept extraction for a document being processed (RF7): calls the llm module, merges
 *    concepts with identical normalised names, keeps at most 100 per document;
 *  - SOURCE VERIFICATION (RF9, SRS 3.2.4.4, RB1) — the one implementation used everywhere:
 *    passage exists in the document + quote found in the passage after normalisation;
 *  - concept management (RF8) with the C-22 rule for merging.
 *
 * Expected exports for other modules: `analyseDocument(documentId)` (called by the documents
 * worker task), `verifySource({ documentId, passageId, quote })` (content), `getOwnedConcept`,
 * `listConceptsForDocument` (content, mastery).
 */
export {};
