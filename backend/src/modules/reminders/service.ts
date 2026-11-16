/**
 * Public surface of the reminders module (Segment 8). Other modules import ONLY from this file.
 *
 * Segment 8 implements here:
 *  - the `Mailer` (SMTP, config.smtp): `sendMail({ to, subject ≤ 100 chars, text })`, with the
 *    retry rules of C-01 (reset link: once after 5 min) and C-16 (reminder: once after 30 min);
 *  - the daily reminder task (RF19): at most one per day per student, at their chosen time,
 *    only when reviews are due, with an unsubscribe link (C-18);
 *  - the cleanup task for expired password-reset tokens (SRS 2.1.7).
 *
 * Expected exports for other modules: `sendPasswordResetEmail` (auth),
 * `remindersWorkerTasks` (src/worker.ts).
 */
export {};
