/**
 * Public surface of the auth module (Segment 1). Other modules import ONLY from this file.
 *
 * Segment 1 implements here:
 *  - registration, login (bcrypt, lock after 5 failures for 15 min — C-17), logout, session JWT
 *    in an httpOnly cookie, password reset tokens (hash stored, 1 h, single use — C-24);
 *  - the global `preHandler` hook that enforces `routeOptions.config.auth` and decorates
 *    `request.user` ({ id, role }); every other module reads the current user from there;
 *  - preferences (one row per user, created with the account — C-23);
 *  - export and deletion of the account (RF20), creation of the initial administrator.
 *
 * Expected exports for other modules: `getUserById`, `listUsers`/`setUserStatus`/`deleteUser`
 * (admin, UC-13), `getPreferences` and `markReminderSent` (reminders).
 */
export {};
