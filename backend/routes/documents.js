const path = require("path");
const express = require("express");
const multer = require("multer");
const { pool } = require("../db");
const { AppError } = require("../errors");
const { getExtractor, SUPPORTED_EXTENSIONS } = require("../extractors");
const { cleanText } = require("../services/textCleaner");

const MAX_FILE_SIZE_MB = 20;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 1 },
  defParamCharset: "utf8", // păstrează diacriticele din numele fișierului
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!getExtractor(ext)) {
      return cb(new AppError(415, "UNSUPPORTED_TYPE",
        `Extensia "${ext || "(fără extensie)"}" nu este suportată. Acceptate: ${SUPPORTED_EXTENSIONS.join(", ")}.`));
    }
    cb(null, true);
  },
});

const router = express.Router();

router.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) {
    throw new AppError(400, "NO_FILE", 'Niciun fișier primit. Trimite fișierul în câmpul "file" (multipart/form-data).');
  }
  if (req.file.size === 0) {
    throw new AppError(400, "EMPTY_FILE", "Fișierul este gol.");
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  const extractor = getExtractor(ext);

  let extracted;
  try {
    extracted = await extractor.extract(req.file.buffer);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(422, "CORRUPT_FILE", "Fișierul nu a putut fi citit.");
  }

  const text = cleanText(extracted.pages, extracted);
  if (!text) {
    throw new AppError(422, "NO_TEXT",
      "Nu s-a putut extrage text din fișier (poate fi un PDF scanat/imagine — OCR nu este suportat).");
  }

  const { rows } = await pool.query(
    `INSERT INTO documents (nume_fisier, tip_fisier, text_extras)
     VALUES ($1, $2, $3)
     RETURNING id, nume_fisier, tip_fisier, data_incarcare`,
    [req.file.originalname, ext.slice(1), text]
  );

  res.status(201).json({
    ...rows[0],
    numar_caractere: text.length,
    previzualizare: text.slice(0, 300),
  });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!/^\d+$/.test(req.params.id) || id < 1 || id > 2147483647) {
    throw new AppError(400, "INVALID_ID", "ID-ul documentului trebuie să fie un număr întreg pozitiv.");
  }

  const { rows } = await pool.query(
    "SELECT id, nume_fisier, tip_fisier, data_incarcare, text_extras FROM documents WHERE id = $1",
    [id]
  );
  if (!rows.length) {
    throw new AppError(404, "NOT_FOUND", `Documentul cu id ${id} nu există.`);
  }

  res.json({ ...rows[0], numar_caractere: rows[0].text_extras.length });
});

module.exports = router;
