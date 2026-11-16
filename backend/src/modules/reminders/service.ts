import type { Config } from '../../core/config.js';
import type { PasswordResetEmail, SendPasswordResetEmail } from '../auth/service.js';

/**
 * Public surface of the reminders module (Segment 8). Other modules import ONLY from this file.
 *
 * Segment 8 implements here:
 *  - the `Mailer` (SMTP, config.smtp): `sendMail({ to, subject ≤ 100 chars, text })`, with the
 *    retry rules of C-01 (reset link: once after 5 min) and C-16 (reminder: once after 30 min);
 *  - the real body of `createPasswordResetSender` below;
 *  - the daily reminder task (RF19): at most one per day per student, at their chosen time,
 *    only when reviews are due, with an unsubscribe link (C-18).
 *
 * Expected exports for other modules: `createPasswordResetSender` (src/app.ts passes its
 * result to the auth service), `remindersWorkerTasks` (src/worker.ts).
 *
 * The cleanup of expired password-reset tokens belongs to the auth module, which owns the table.
 */

interface MailLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

/**
 * TEMPORARY SENDER, until Segment 8 sends real e-mail. It exists so that the reset flow of
 * Segment 1 works end to end during development:
 *
 *  - outside production it writes the reset link to the log, so a developer can open it;
 *  - in production it sends nothing and logs a warning WITHOUT the link, the token or the
 *    address. A reset link is a credential: it must never reach production logs.
 *
 * Segment 8 replaces the body with an SMTP send and removes the development log line.
 */
export function createPasswordResetSender(deps: {
  config: Config;
  log: MailLog;
}): SendPasswordResetEmail {
  return async (message: PasswordResetEmail) => {
    if (deps.config.env === 'production') {
      deps.log.warn(
        { event: 'mail.password_reset_not_sent' },
        'password reset e-mail NOT sent: the mailer is not implemented yet (Segment 8)',
      );
      return;
    }
    deps.log.info(
      {
        event: 'mail.password_reset_dev_link',
        to: message.to,
        reset_url: message.resetUrl,
        expires_at: message.expiresAt.toISOString(),
      },
      'DEVELOPMENT ONLY: password reset link (no e-mail is sent until Segment 8)',
    );
  };
}
