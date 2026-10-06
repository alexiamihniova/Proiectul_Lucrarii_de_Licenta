const { PDFParse } = require("pdf-parse");
const { AppError } = require("../errors");

async function extract(buffer) {
  // Semnătura "%PDF" apare la începutul fișierului (uneori după câțiva octeți de gunoi).
  if (!buffer.subarray(0, 1024).includes("%PDF")) {
    throw new AppError(422, "CORRUPT_FILE", "Fișierul nu este un PDF valid.");
  }

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return { pages: result.pages.map((p) => p.text), detectRepeatedLines: true };
  } catch (err) {
    if (err.name === "PasswordException") {
      throw new AppError(422, "ENCRYPTED_FILE", "PDF-ul este protejat cu parolă.");
    }
    throw new AppError(422, "CORRUPT_FILE", "PDF-ul este corupt sau nu poate fi citit.");
  } finally {
    await parser.destroy();
  }
}

module.exports = { extensions: [".pdf"], extract };
