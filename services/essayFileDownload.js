/* global fetch */
const fs = require('fs').promises;
const config = require('../config');

function joinStorageBaseUrl(baseUrl, filePath) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const path = String(filePath).replace(/^\/+/, '');
  return `${base}/${path}`;
}

async function downloadEssayBuffer(upload) {
  const { file_path: filePath } = upload;
  if (!filePath) {
    throw new Error('Missing file_path');
  }

  if (config.essayStorageBucket) {
    const url = joinStorageBaseUrl(config.essayStorageBucket, filePath);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download essay file (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  if (filePath.startsWith('https://') || filePath.startsWith('http://')) {
    const res = await fetch(filePath);
    if (!res.ok) {
      throw new Error(`Failed to download URL (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  return fs.readFile(filePath);
}

module.exports = { downloadEssayBuffer };
