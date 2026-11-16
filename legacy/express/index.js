require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { pool, initSchema } = require("./db");
const { AppError } = require("./errors");
const documentsRouter = require("./routes/documents");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.use("/documents", documentsRouter);

app.use((req, res) => {
  res.status(404).json({ error: { code: "ROUTE_NOT_FOUND", message: `Ruta ${req.method} ${req.path} nu există.` } });
});

// Handler central de erori: orice eroare ajunge aici ca JSON, nimic nu rămâne necaptat.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: { code: "FILE_TOO_LARGE", message: "Fișierul depășește limita de 20 MB." } });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ error: { code: "BAD_UPLOAD", message: 'Trimite un singur fișier, în câmpul "file".' } });
    }
    return res.status(400).json({ error: { code: "BAD_UPLOAD", message: err.message } });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "INVALID_JSON", message: "Corpul cererii nu este JSON valid." } });
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Eroare internă a serverului." } });
});

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Nu s-a putut inițializa baza de date:", err.message);
    process.exit(1);
  });
