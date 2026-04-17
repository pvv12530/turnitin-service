/* global fetch, FormData, Blob */
const config = require('../config');

function getBaseAndKey() {
  const baseUrl = (config.mplagBaseUrl || '').replace(/\/$/, '');
  const apiKey = config.mplagApiKey;
  return { baseUrl, apiKey };
}

async function submitFile(buffer, fileName, mimeType) {
  const { baseUrl, apiKey } = getBaseAndKey();
  if (!baseUrl || !apiKey) {
    throw new Error('MPLAG_BASE_URL and MPLAG_API_KEY are required');
  }

  const form = new FormData();
  const blob = new Blob([buffer], {
    type: mimeType || 'application/octet-stream',
  });
  form.append('file', blob, fileName);

  const res = await fetch(`${baseUrl}/api-submit`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body: form,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || json.message || `HTTP ${res.status}`);
  }
  if (json.success === false) {
    throw new Error(json.message || json.error || 'Submit failed');
  }
  if (!json.data) {
    throw new Error(
      json.message || json.error || 'Submit response missing data'
    );
  }
  return json.data;
}

async function getSubmissionStatus(submissionId) {
  const { baseUrl, apiKey } = getBaseAndKey();
  if (!baseUrl || !apiKey) {
    throw new Error('MPLAG_BASE_URL and MPLAG_API_KEY are required');
  }

  const url = `${baseUrl}/api-submit?action=list&id=${encodeURIComponent(
    submissionId
  )}`;
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || json.message || `HTTP ${res.status}`);
  }
  if (!json.data) {
    throw new Error(
      json.message || json.error || 'Status response missing data'
    );
  }
  return json.data;
}

async function requestDownloadToken(submissionId, report) {
  const { baseUrl, apiKey } = getBaseAndKey();
  if (!baseUrl || !apiKey) {
    throw new Error('MPLAG_BASE_URL and MPLAG_API_KEY are required');
  }

  const res = await fetch(`${baseUrl}/api-download-token`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ submission_id: submissionId, report }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || json.message || `HTTP ${res.status}`);
  }
  return json;
}

module.exports = { submitFile, getSubmissionStatus, requestDownloadToken };
