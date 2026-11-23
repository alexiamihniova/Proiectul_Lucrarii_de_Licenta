/**
 * Single error catalogue for the whole API.
 *
 * Every error leaves the server as `{ "error": { "code", "message", "details" } }`.
 * `code` is the stable identifier clients switch on; `message` is the Romanian text shown to
 * the user; `srs` links the code to the message table of the SRS (Tabelul 3.2, M01–M10).
 *
 * Segments add new codes HERE (never ad-hoc strings in a module) and throw `new AppError(code)`.
 */

interface ErrorDefinition {
  status: number;
  message: string;
  /** Message id in SRS Tabelul 3.2, when the error corresponds to one. */
  srs?: string;
}

export const ERRORS = {
  // --- generic ---------------------------------------------------------------------------
  VALIDATION_ERROR: { status: 400, message: 'Datele trimise nu sunt valide.' },
  UNAUTHENTICATED: {
    status: 401,
    message: 'Sesiunea a expirat sau lipsește. Autentifică-te din nou.',
  },
  FORBIDDEN: { status: 403, message: 'Nu ai dreptul să faci această acțiune.' },
  /** CSRF defence (ADR-0011): the request comes from another origin. */
  ORIGIN_NOT_ALLOWED: {
    status: 403,
    message: 'Cererea vine de pe un alt site și a fost refuzată.',
  },
  /** Per-IP rate limit (Q33): details = { retry_after_seconds }. */
  TOO_MANY_REQUESTS: {
    status: 429,
    message: 'Prea multe cereri. Încearcă din nou peste puțin timp.',
  },
  NOT_FOUND: { status: 404, message: 'Resursa cerută nu există.' },
  ROUTE_NOT_FOUND: { status: 404, message: 'Ruta cerută nu există.' },
  CONFLICT: { status: 409, message: 'Acțiunea intră în conflict cu starea curentă a resursei.' },
  INTERNAL_ERROR: { status: 500, message: 'Eroare internă a serverului.' },
  NOT_IMPLEMENTED: { status: 501, message: 'Funcționalitatea nu este încă implementată.' },

  // --- auth (Segment 1) ------------------------------------------------------------------
  INVALID_REGISTRATION_DATA: {
    status: 400,
    srs: 'M01',
    message:
      'Verifică datele: adresa de e-mail trebuie să fie validă, iar parola să aibă 8–64 de caractere, cu cel puțin o literă și o cifră.',
  },
  EMAIL_ALREADY_EXISTS: {
    status: 409,
    srs: 'M02',
    message: 'Există deja un cont cu această adresă. Autentifică-te sau resetează parola.',
  },
  INVALID_CREDENTIALS: {
    status: 401,
    srs: 'M03',
    message:
      'E-mailul sau parola sunt greșite. După 5 încercări greșite, autentificarea se blochează 15 minute.',
  },
  /** C-12, C-17: details = { retry_after_seconds }. */
  ACCOUNT_TEMPORARILY_LOCKED: {
    status: 429,
    srs: 'M03',
    message: 'Prea multe încercări greșite. Autentificarea este blocată temporar.',
  },
  ACCOUNT_BLOCKED: { status: 403, message: 'Contul este blocat de administrator.' },
  /** C-24 */
  RESET_TOKEN_INVALID: {
    status: 400,
    message: 'Linkul de resetare este invalid, expirat sau a fost deja folosit.',
  },
  PASSWORD_CONFIRMATION_FAILED: { status: 403, message: 'Parola introdusă nu este corectă.' },
  /** bcrypt ignores everything after 72 bytes (ADR-0010, Q34). */
  PASSWORD_TOO_LONG: {
    status: 400,
    srs: 'M01',
    message:
      'Parola este prea lungă: poate avea cel mult 72 de octeți (literele cu diacritice ocupă câte 2).',
  },

  // --- subjects & documents (Segment 2) --------------------------------------------------
  SUBJECT_NAME_TAKEN: { status: 409, message: 'Ai deja o materie cu acest nume.' },
  UNSUPPORTED_FILE_FORMAT: {
    status: 415,
    srs: 'M04',
    message: 'Formatul fișierului nu este acceptat. Încarcă un PDF, DOCX sau TXT.',
  },
  /**
   * details = { exceeded: 'size' | 'pages' | 'complexity', limit_mb, limit_pages }, plus
   * `pages` (the count found) when exceeded = 'pages', and `reason` ('timeout' | 'memory') when
   * exceeded = 'complexity': a PDF whose pages could not be counted within the limits (Q48).
   */
  FILE_TOO_LARGE: {
    status: 413,
    srs: 'M05',
    message: 'Fișierul depășește limita de dimensiune sau de pagini. Încarcă o variantă mai mică.',
  },
  /** Not an HTTP error: stored in documents.error_reason when analysis fails (RF4). */
  TEXT_NOT_EXTRACTABLE: {
    status: 422,
    srs: 'M06',
    message: 'Documentul nu a putut fi citit. Încarcă o versiune în care textul poate fi selectat.',
  },
  /** details = { limit, resets_at } */
  DAILY_UPLOAD_LIMIT_REACHED: {
    status: 429,
    srs: 'M08',
    message: 'Ai atins limita zilnică de încărcări. Revino mâine.',
  },
  /** C-09 */
  DOCUMENT_ALREADY_PROCESSING: { status: 409, message: 'Documentul este deja în procesare.' },
  /** T2, PE: stored in documents.error_reason when the analysis exceeds the time limit. */
  DOCUMENT_PROCESSING_TIMEOUT: {
    status: 504,
    message: 'Analiza documentului a durat prea mult. Încearcă reprocesarea.',
  },
  DOCUMENT_NOT_READY: {
    status: 409,
    message: 'Documentul nu este încă analizat complet.',
  },

  // --- analysis & LLM (Segment 3) --------------------------------------------------------
  LLM_UNAVAILABLE: {
    status: 503,
    srs: 'M07',
    message:
      'Serviciul de analiză nu este disponibil acum. Poți continua cu materialele existente; încearcă din nou mai târziu.',
  },
  SOURCE_NOT_VERIFIED: {
    status: 422,
    srs: 'M09',
    message: 'Sursa acestui material nu a putut fi verificată în document.',
  },
  /** C-22 */
  CONCEPTS_IN_DIFFERENT_DOCUMENTS: {
    status: 409,
    message: 'Se pot uni numai concepte din același document.',
  },

  // --- content: materials & tests (Segment 4) --------------------------------------------
  /** C-19 */
  MATERIAL_ALREADY_REPORTED: { status: 409, message: 'Ai raportat deja acest material.' },
  NOT_ENOUGH_MATERIALS: {
    status: 409,
    message: 'Nu există suficiente materiale verificate pentru acest test.',
  },
  TEST_ALREADY_FINISHED: { status: 409, message: 'Testul este deja finalizat.' },
  TEST_NOT_FINISHED: { status: 409, message: 'Testul nu este încă finalizat.' },

  // --- reminders (Segment 8) -------------------------------------------------------------
  UNSUBSCRIBE_TOKEN_INVALID: { status: 400, message: 'Linkul de dezabonare nu este valid.' },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERRORS;

export const ERROR_CODES = Object.keys(ERRORS) as [ErrorCode, ...ErrorCode[]];

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly details?: unknown,
    message?: string,
  ) {
    super(message ?? ERRORS[code].message);
    this.name = 'AppError';
    this.status = ERRORS[code].status;
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function errorBody(code: ErrorCode, details?: unknown, message?: string): ErrorBody {
  return {
    error: {
      code,
      message: message ?? ERRORS[code].message,
      ...(details === undefined ? {} : { details }),
    },
  };
}
