/**
 * Public surface of the mastery module (Segment 5). Other modules import ONLY from this file.
 *
 * Segment 5 implements here, as PURE functions with ≥ 70 % test coverage (RNF14):
 *  - mastery S = 100 · Σ(wₖ·cₖ) / Σwₖ, wₖ = decayᵏ, last `window` answers (RB2, SRS 3.2.4.2);
 *  - SM-2 scheduling (RB3, SRS 3.2.4.3);
 * and around them: `concept_progress` / `reviews` persistence, the review queue and session,
 * progress views (RF15), the `celebrated` flag (RF17).
 * Thresholds, window and decay come from the admin module's settings, never from constants.
 *
 * Expected exports for other modules: `recordAnswer({ userId, conceptId, score, quality })`
 * (content — called after every answer), `getMasteryForConcepts` (analysis),
 * `countDueConcepts(userId)` (documents, reminders).
 */
export {};
