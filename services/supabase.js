const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

let client;

function getSupabase() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    return null;
  }
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

module.exports = { getSupabase };
