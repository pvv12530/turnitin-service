require('dotenv').config();

const config = {
  port: 5000,
  API_KEY_JWT: process.env.API_KEY_JWT,
  TOKEN_EXPIRES_IN: process.env.TOKEN_EXPIRES_IN,

  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,

  mplagBaseUrl:
    process.env.MPLAG_BASE_URL ||
    'https://ylvabllriyjffvawbwar.supabase.co/functions/v1',
  mplagApiKey: process.env.MPLAG_API_KEY,

  /**
   * Base URL for essay storage (no trailing slash). `file_path` is appended to build the full download URL.
   * Example: https://<project>.supabase.co/storage/v1/object/public/<bucket>
   */
  essayStorageBucket: process.env.ESSAY_STORAGE_BUCKET || null,

  /**
   * Supabase Storage bucket name to upload MyPlag reports into.
   * If unset, we try to infer it from ESSAY_STORAGE_BUCKET (public URL).
   */
  reportsStorageBucketName: process.env.REPORTS_STORAGE_BUCKET_NAME || null,

  mplagStatusPollMs: process.env.MPLAG_STATUS_POLL_MS
    ? parseInt(process.env.MPLAG_STATUS_POLL_MS, 10)
    : 30 * 1000,

  mplagMaxWaitMs: process.env.MPLAG_MAX_WAIT_MS
    ? parseInt(process.env.MPLAG_MAX_WAIT_MS, 10)
    : 2 * 60 * 60 * 1000,

  essayPollerIntervalMs: process.env.ESSAY_POLLER_INTERVAL_MS
    ? parseInt(process.env.ESSAY_POLLER_INTERVAL_MS, 10)
    : 30 * 1000,

  /** Bot token for Telegram Bot API (sendMessage). Optional; notifications skipped if unset. */
  telegramBotToken:
    process.env.TELEGRAM_BOT_TOKEN || process.env.telegramBotToken || null,
};

module.exports = config;
