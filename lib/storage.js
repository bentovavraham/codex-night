// Abstracted file storage. Today: local disk (ephemeral on Render — files
// disappear on redeploy, which is fine for early testing). Future: SharePoint.
//
// The public interface is stable so only this file needs to change when we
// swap backends:
//
//   save(buffer, { filename, mimeType }) -> { reference, size, mimeType, filename }
//   read(reference)                       -> { buffer, mimeType, filename }
//   remove(reference)                     -> void
//
// `reference` is the string stored in `file_reference` columns on contracts
// and invoices. In the local backend it's a random hex ID; when SharePoint
// lands it will be the SharePoint item URL / drive path. Anything using it
// should treat it as opaque.

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(__dirname, '..', 'uploads');

// Sidecar metadata file: <id>.meta.json with {filename, mimeType}. Kept next
// to the blob so we can restore the original filename on download.
function pathsFor(id) {
  return {
    blob: path.join(UPLOADS_DIR, `${id}.bin`),
    meta: path.join(UPLOADS_DIR, `${id}.meta.json`),
  };
}

async function ensureDir() {
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
}

async function save(buffer, { filename = 'upload', mimeType = 'application/octet-stream' } = {}) {
  await ensureDir();
  const id = crypto.randomBytes(16).toString('hex');
  const { blob, meta } = pathsFor(id);
  await fsp.writeFile(blob, buffer);
  await fsp.writeFile(meta, JSON.stringify({ filename, mimeType }, null, 2));
  return {
    reference: `local:${id}`,
    size: buffer.length,
    mimeType,
    filename,
  };
}

function parseReference(reference) {
  if (typeof reference !== 'string') return null;
  const m = reference.match(/^local:([a-f0-9]{32})$/);
  if (!m) return null;
  return m[1];
}

async function read(reference) {
  const id = parseReference(reference);
  if (!id) throw new Error('Unknown or unsupported file reference');
  const { blob, meta } = pathsFor(id);
  const [buffer, metaText] = await Promise.all([
    fsp.readFile(blob),
    fsp.readFile(meta, 'utf8'),
  ]);
  const { filename, mimeType } = JSON.parse(metaText);
  return { buffer, filename, mimeType };
}

async function remove(reference) {
  const id = parseReference(reference);
  if (!id) return;
  const { blob, meta } = pathsFor(id);
  await Promise.allSettled([fsp.unlink(blob), fsp.unlink(meta)]);
}

module.exports = { save, read, remove, UPLOADS_DIR };
