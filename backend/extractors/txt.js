const { AppError } = require("../errors");

function decode(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer);

  if (buffer.includes(0)) {
    throw new AppError(422, "CORRUPT_FILE", "Fișierul .txt conține date binare, nu text.");
  }

  try {
    // TextDecoder elimină automat BOM-ul UTF-8.
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    // Fișiere românești mai vechi (Notepad pe Windows) sunt adesea în Windows-1250.
    return new TextDecoder("windows-1250").decode(buffer);
  }
}

async function extract(buffer) {
  return { pages: [decode(buffer)], detectRepeatedLines: false };
}

module.exports = { extensions: [".txt"], extract };
