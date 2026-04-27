// Abstracted file storage. Current backend: Postgres (survives Render redeploys).
// Future: SharePoint integration — only this file needs to change.
//
//   save(buffer, { filename, mimeType }) -> { reference, size, mimeType, filename }
//   read(reference)                       -> { buffer, mimeType, filename }
//   remove(reference)                     -> void

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

async function save(buffer, { filename = 'upload', mimeType = 'application/octet-stream' } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO files (id, filename, mime_type, data, size) VALUES ($1, $2, $3, $4, $5)',
    [id, filename, mimeType, buffer, buffer.length]
  );
  return { reference: `pg:${id}`, size: buffer.length, mimeType, filename };
}

function parseReference(reference) {
  if (typeof reference !== 'string') return null;
  // Support both old local: refs and new pg: refs
  const m = reference.match(/^(?:pg|local):(.+)$/);
  return m ? m[1] : null;
}

async function read(reference) {
  // Handle disk-stored import queue files (e.g. "uploads/1234-abc.pdf")
  if (typeof reference === 'string' && reference.startsWith('uploads/')) {
    const filename = path.basename(reference);
    const filepath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filepath)) throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
    const buffer = fs.readFileSync(filepath);
    return { buffer, filename, mimeType: 'application/pdf' };
  }

  const id = parseReference(reference);
  if (!id) throw new Error('Unknown or unsupported file reference');
  const { rows } = await pool.query(
    'SELECT data, filename, mime_type FROM files WHERE id = $1', [id]
  );
  if (!rows.length) throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
  return { buffer: rows[0].data, filename: rows[0].filename, mimeType: rows[0].mime_type };
}

async function remove(reference) {
  const id = parseReference(reference);
  if (!id) return;
  await pool.query('DELETE FROM files WHERE id = $1', [id]);
}

module.exports = { save, read, remove };
