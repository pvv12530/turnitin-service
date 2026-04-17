/* global fetch */
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const TG_API = 'https://api.telegram.org';

function truncateDetail(text, maxLen) {
  if (text == null) return '';
  const s = String(text);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inferSupabaseBucketNameFromPublicBaseUrl(publicBaseUrl) {
  if (!publicBaseUrl) return null;
  const s = String(publicBaseUrl);
  const m = s.match(/\/storage\/v1\/object\/public\/([^/?#]+)\/?$/i);
  return m ? m[1] : null;
}

function safeFilenameFromUrl(url, fallback) {
  try {
    const u = new URL(url);
    const base = path.basename(u.pathname);
    if (base && base !== '/' && base !== '.' && base !== '..') return base;
    return fallback;
  } catch {
    return fallback;
  }
}

function extFromContentType(contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('application/pdf')) return '.pdf';
  if (ct.includes('application/json')) return '.json';
  if (ct.includes('text/html')) return '.html';
  if (ct.includes('text/plain')) return '.txt';
  if (ct.includes('application/zip')) return '.zip';
  if (ct.includes('image/png')) return '.png';
  if (ct.includes('image/jpeg')) return '.jpg';
  return '';
}

async function materializeReportToStorageUrl(
  supabase,
  upload,
  reportUrl,
  kind
) {
  if (!supabase || !reportUrl) return reportUrl;

  const bucket =
    config.reportsStorageBucketName ||
    inferSupabaseBucketNameFromPublicBaseUrl(config.essayStorageBucket);
  if (!bucket) return reportUrl;

  let res;
  try {
    res = await fetch(String(reportUrl));
  } catch (err) {
    return reportUrl;
  }

  if (!res.ok) {
    return reportUrl;
  }

  const contentType = res.headers.get('content-type') || undefined;
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extFromContentType(contentType);
  const original = safeFilenameFromUrl(
    reportUrl,
    `${kind || 'report'}${ext || ''}`
  );
  const base = path.parse(original).name || `${kind || 'report'}`;
  const finalName = `${base}${ext || path.extname(original) || ''}`;
  const objectPath = [
    'reports',
    String(upload && upload.user_id ? upload.user_id : 'unknown-user'),
    String(upload && upload.id ? upload.id : 'unknown-upload'),
    `${kind || 'report'}-${Date.now()}-${crypto
      .randomBytes(6)
      .toString('hex')}-${finalName}`,
  ].join('/');

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(objectPath, buf, {
      contentType,
      upsert: true,
    });
  if (upErr) {
    return reportUrl;
  }

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  const publicUrl = pub && pub.publicUrl ? String(pub.publicUrl) : '';
  return publicUrl || reportUrl;
}

async function resolveTelegramChatId(supabase, userId) {
  if (!supabase || userId == null) return null;
  const { data, error } = await supabase
    .from('users')
    .select('telegram_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[telegramNotify] users lookup error:', {
      userId,
      message: error.message,
      code: error.code,
    });
    return null;
  }
  if (!data || data.telegram_id == null) return null;
  return String(data.telegram_id);
}

async function sendTelegramMessage(chatId, text, options = {}) {
  const token = config.telegramBotToken;
  if (!token || !chatId) return false;

  const res = await fetch(
    `${TG_API}/bot${encodeURIComponent(token)}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(options && typeof options === 'object' ? options : {}),
      }),
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!json.ok) {
    console.error('[telegramNotify] sendMessage failed:', {
      chatId,
      status: res.status,
      description: json.description,
    });
    return false;
  }
  return true;
}

async function notifyEssayUploadOutcome(supabase, upload, { outcome, detail }) {
  if (!config.telegramBotToken) {
    return;
  }
  const chatId = await resolveTelegramChatId(supabase, upload.user_id);
  if (!chatId) {
    console.warn('[telegramNotify] skip notify: no telegram_id', {
      userId: upload.user_id,
      outcome,
    });
    return;
  }

  const fileLabel = upload.file_name || 'your file';
  let text;
  if (outcome === 'completed') {
    const completion = detail && typeof detail === 'object' ? detail : {};
    const ai = completion.ai_score;
    const sim = completion.similarity_score;

    const lines = [];
    lines.push('✅ <b>Document Analysis Complete!</b>');
    lines.push('');
    lines.push(`📄 <b>File:</b> ${escapeHtml(fileLabel)}`);
    lines.push('');
    lines.push('📊 <b>Analysis Results:</b>');
    lines.push('');
    if (ai) lines.push(`🤖 <b>AI Detection:</b> ${ai}`);
    if (sim) lines.push(`📄 <b>Similarity:</b> ${sim}`);
    lines.push('');

    const report1 = completion.report_1_url
      ? String(completion.report_1_url)
      : '';
    const report2 = completion.report_2_url
      ? String(completion.report_2_url)
      : '';

    const report1Stored = report1
      ? await materializeReportToStorageUrl(
          supabase,
          upload,
          report1,
          'similarity'
        )
      : '';
    const report2Stored = report2
      ? await materializeReportToStorageUrl(
          supabase,
          upload,
          report2,
          'ai-detection'
        )
      : '';

    if (report1 || report2) {
      lines.push('📎 <b>Download Reports:</b>');
      lines.push('');
      if (report1Stored) {
        lines.push(
          `📄 <a href="${escapeHtml(report1Stored)}">Similarity Report</a>`
        );
      }
      if (report2Stored) {
        lines.push(
          `🤖 <a href="${escapeHtml(report2Stored)}">AI Detection Report</a>`
        );
      }
    }

    text = lines.join('\n');
  } else if (outcome === 'rejected') {
    text = `❌ <b>Document Analysis Rejected</b>\n\n📄 <b>File:</b> ${escapeHtml(
      fileLabel
    )}`;
  } else {
    const err = escapeHtml(truncateDetail(detail || 'Unknown error', 800));
    text = `⚠️ <b>Document Analysis Failed</b>\n\n📄 <b>File:</b> ${escapeHtml(
      fileLabel
    )}\n\n<b>Error:</b> ${err}`;
  }

  const ok = await sendTelegramMessage(chatId, text, { parse_mode: 'HTML' });
  if (ok) {
    console.log('[telegramNotify] user notified', {
      outcome,
      userId: upload.user_id,
    });
  }
}

module.exports = {
  notifyEssayUploadOutcome,
  resolveTelegramChatId,
  sendTelegramMessage,
};
