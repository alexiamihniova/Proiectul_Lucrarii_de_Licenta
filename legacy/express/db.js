const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id             SERIAL PRIMARY KEY,
      nume_fisier    TEXT        NOT NULL,
      tip_fisier     VARCHAR(10) NOT NULL,
      text_extras    TEXT        NOT NULL,
      data_incarcare TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

module.exports = { pool, initSchema };
