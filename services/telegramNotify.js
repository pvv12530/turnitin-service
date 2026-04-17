/* global fetch */
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
    if (report1 || report2) {
      lines.push('📎 <b>Download Reports:</b>');
      lines.push('');
      if (report1) {
        lines.push(`📄 <a href="${escapeHtml(report1)}">Similarity Report</a>`);
      }
      if (report2) {
        lines.push(
          `🤖 <a href="${escapeHtml(report2)}">AI Detection Report</a>`
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
