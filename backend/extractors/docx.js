const mammoth = require("mammoth");
const { AppError } = require("../errors");

async function extract(buffer) {
  // .docx este o arhivă ZIP, deci începe cu "PK".
  if (buffer.subarray(0, 2).toString("latin1") !== "PK") {
    throw new AppError(422, "CORRUPT_FILE", "Fișierul nu este un DOCX valid (formatul vechi .doc nu este suportat).");
  }

  try {
    const result = await mammoth.extractRawText({ buffer });
    return { pages: [result.value], detectRepeatedLines: false };
  } catch (err) {
    throw new AppError(422, "CORRUPT_FILE", "DOCX-ul este corupt sau nu poate fi citit.");
  }
}

module.exports = { extensions: [".docx"], extract };
