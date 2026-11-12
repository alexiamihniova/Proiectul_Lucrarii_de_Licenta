/**
 * Public surface of the content module (Segment 4). Other modules import ONLY from this file.
 *
 * Segment 4 implements here:
 *  - material generation with decision rules R1–R5 (Dosar, Tabelul 4.3): format (via llm),
 *    duplicate (C-13), source verification (via analysis — never re-implemented here);
 *  - tests: configuration, questions, answers, evaluation, result (RF11–RF13, C-04, C-05);
 *  - reports of wrong materials (C-19).
 * After each recorded answer it calls the mastery module's service (RF14, RF16); it contains
 * no mastery or SM-2 formula.
 *
 * Expected exports for other modules: `getReviewableMaterials(conceptIds)` and
 * `recordReviewAnswer` (mastery), `listReports` / `resolveReport` / `removeMaterial` (admin).
 */
export {};
