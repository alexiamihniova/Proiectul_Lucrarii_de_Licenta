// Eroare "așteptată" (validare, fișier corupt etc.) care ajunge la client ca JSON cu status-ul dat.
class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = { AppError };
