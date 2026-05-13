// Abstracted file storage. Current backend: Postgres (survives Render redeploys).
// Future: SharePoint integration — only this file needs to change.
//
//   save(buffer, { filename, mimeType }) -> { reference, size, mimeType, filename }
//   read(reference)                       -> { buffer, mimeType, filename }
//   remove(reference)                     -> void

const crypto = require('crypto');
const pool = require('../db/pool');

let filesShape = null;

async function getFilesShape() {
  if (filesShape) return filesShape;
  const { rows } = await pool.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'files'`
  );
  const columns = new Map(rows.map(r => [r.column_name, r.data_type]));
  filesShape = {
    idIsInteger: columns.get('id') === 'integer',
    hasSize: columns.has('size'),
    hasSizeBytes: columns.has('size_bytes'),
  };
  return filesShape;
}

async function save(buffer, { filename = 'upload', mimeType = 'application/octet-stream' } = {}) {
  const shape = await getFilesShape();
  let id;
  if (shape.idIsInteger) {
    const sizeColumn = shape.hasSizeBytes ? 'size_bytes' : 'size';
    const r = await pool.query(
      `INSERT INTO files (filename, mime_type, data, ${sizeColumn})
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [filename, mimeType, buffer, buffer.length]
    );
    id = r.rows[0].id;
  } else {
    id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO files (id, filename, mime_type, data, size) VALUES ($1, $2, $3, $4, $5)',
      [id, filename, mimeType, buffer, buffer.length]
    );
  }
  return { reference: `pg:${id}`, size: buffer.length, mimeType, filename };
}

function parseReference(reference) {
  if (typeof reference !== 'string') return null;
  // Support both old local: refs and new pg: refs
  const m = reference.match(/^(?:pg|local):(.+)$/);
  return m ? m[1] : null;
}

async function read(reference) {
  const id = parseReference(reference);
  if (!id) throw new Error('Unknown or unsupported file reference');
  const shape = await getFilesShape();
  const { rows } = await pool.query(
    `SELECT data, filename, mime_type FROM files WHERE id = $1${shape.idIsInteger ? '::integer' : ''}`,
    [id]
  );
  if (!rows.length) throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
  return { buffer: rows[0].data, filename: rows[0].filename, mimeType: rows[0].mime_type };
}

async function remove(reference) {
  const id = parseReference(reference);
  if (!id) return;
  const shape = await getFilesShape();
  await pool.query(`DELETE FROM files WHERE id = $1${shape.idIsInteger ? '::integer' : ''}`, [id]);
}

module.exports = { save, read, remove };
