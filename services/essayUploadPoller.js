const config = require('../config');
const { getSupabase } = require('./supabase');
const mplag = require('./mplagClient');
const { downloadEssayBuffer } = require('./essayFileDownload');
const { notifyEssayUploadOutcome } = require('./telegramNotify');

const DEFAULT_INTERVAL_MS = 10 * 1000;
const DEFAULT_MAX_WAIT_MS = 2 * 60 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function supabaseErrDetail(err) {
  if (!err) return null;
  return {
    message: err.message,
    code: err.code,
    details: err.details,
    hint: err.hint,
  };
}

async function claimNextEssayUpload() {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: candidates, error } = await supabase
    .from('essay_uploads')
    .select('*')
    .eq('payment_status', 'paid')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error(
      '[essayUploadPoller] claim select error:',
      supabaseErrDetail(error)
    );
    return null;
  }
  if (!candidates || !candidates.length) return null;

  const row = candidates[0];
  const { data: updated, error: updateError } = await supabase
    .from('essay_uploads')
    .update({
      status: 'processing',
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'queued')
    .select()
    .maybeSingle();

  if (updateError) {
    console.error(
      '[essayUploadPoller] claim update error:',
      supabaseErrDetail(updateError)
    );
    return null;
  }
  if (!updated) {
    console.warn('[essayUploadPoller] claim race lost (row no longer queued)', {
      id: row.id,
      file_name: row.file_name,
    });
    return null;
  }
  return updated;
}

async function markFailed(upload, message) {
  const supabase = getSupabase();
  if (!supabase) return;
  const uploadId = upload.id;
  const note = JSON.stringify({ error: message, at: new Date().toISOString() });
  console.error('[essayUploadPoller] marking upload failed', {
    uploadId,
    message,
  });
  const { error } = await supabase
    .from('essay_uploads')
    .update({
      status: 'failed',
      note,
      updated_at: new Date().toISOString(),
    })
    .eq('id', uploadId);
  if (error) {
    console.error(
      '[essayUploadPoller] markFailed db update error:',
      supabaseErrDetail(error)
    );
    return;
  }
  await notifyEssayUploadOutcome(supabase, upload, {
    outcome: 'failed',
    detail: message,
  });
}

async function waitForMyPlagResult(supabase, upload, submissionId) {
  const pollMs = config.mplagStatusPollMs || DEFAULT_INTERVAL_MS;
  const maxWaitMs = config.mplagMaxWaitMs || DEFAULT_MAX_WAIT_MS;
  const deadline = Date.now() + maxWaitMs;
  const waitStartedAt = Date.now();
  let pollCount = 0;
  let lastStatus;

  console.log('[essayUploadPoller] waiting for MyPlag result', {
    uploadId: upload.id,
    submissionId,
    pollMs,
    maxWaitMs,
    deadlineAt: new Date(deadline).toISOString(),
  });

  const pollOnce = async () => {
    pollCount += 1;
    if (Date.now() >= deadline) {
      console.error('[essayUploadPoller] mplag wait deadline exceeded', {
        uploadId: upload.id,
        submissionId,
        pollCount,
        waitedMs: Date.now() - waitStartedAt,
        maxWaitMs,
      });
      await markFailed(upload, 'Timed out waiting for MyPlagAI result');
      return;
    }

    let lastData;
    try {
      lastData = await mplag.getSubmissionStatus(submissionId);
    } catch (err) {
      console.error('[essayUploadPoller] status poll error:', {
        uploadId: upload.id,
        submissionId,
        pollCount,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      await markFailed(
        upload,
        `status: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    const st = lastData && lastData.status;
    const statusChanged = st !== lastStatus;
    if (statusChanged || pollCount === 1 || pollCount % 12 === 0) {
      console.log('[essayUploadPoller] mplag status poll', {
        uploadId: upload.id,
        submissionId,
        pollCount,
        status: st ?? null,
        statusChanged: statusChanged || undefined,
        waitedMs: Date.now() - waitStartedAt,
        msRemaining: Math.max(0, deadline - Date.now()),
        myplagKeys:
          lastData && typeof lastData === 'object'
            ? Object.keys(lastData)
            : undefined,
      });
    }
    lastStatus = st;

    if (st === 'completed') {
      const completion = {
        completed_at: lastData.completed_at || new Date().toISOString(),
        submitted_at: lastData.submitted_at,
        similarity_score: lastData.similarity_score,
        ai_score: lastData.ai_score,
        report_1_url: lastData.report_1_url,
        report_2_url: lastData.report_2_url,
        deletion_remaining_seconds: lastData.deletion_remaining_seconds,
      };
      const notePayload = {
        completed_at: completion.completed_at,
        completion,
        myplag: lastData,
      };
      const { error: completeErr } = await supabase
        .from('essay_uploads')
        .update({
          status: 'completed',
          note: JSON.stringify(notePayload),
          updated_at: new Date().toISOString(),
        })
        .eq('id', upload.id);
      if (completeErr) {
        console.error(
          '[essayUploadPoller] completed db update error:',
          supabaseErrDetail(completeErr)
        );
      } else {
        console.log('[essayUploadPoller] upload marked completed', {
          uploadId: upload.id,
          submissionId,
          pollCount,
          waitedMs: Date.now() - waitStartedAt,
          completed_at: completion.completed_at,
          similarity_score: completion.similarity_score,
          ai_score: completion.ai_score,
          report_1_url: completion.report_1_url,
          report_2_url: completion.report_2_url,
        });
        await notifyEssayUploadOutcome(supabase, upload, {
          outcome: 'completed',
          detail: completion,
        });
      }
      return;
    }

    if (st === 'rejected') {
      const notePayload = {
        rejected_at: lastData.rejected_at,
        myplag: lastData,
      };
      const { error: rejectErr } = await supabase
        .from('essay_uploads')
        .update({
          status: 'rejected',
          note: JSON.stringify(notePayload),
          updated_at: new Date().toISOString(),
        })
        .eq('id', upload.id);
      if (rejectErr) {
        console.error(
          '[essayUploadPoller] rejected db update error:',
          supabaseErrDetail(rejectErr)
        );
      } else {
        console.log('[essayUploadPoller] upload marked rejected', {
          uploadId: upload.id,
          submissionId,
          pollCount,
          waitedMs: Date.now() - waitStartedAt,
          rejected_at: lastData.rejected_at,
        });
        await notifyEssayUploadOutcome(supabase, upload, {
          outcome: 'rejected',
        });
      }
      return;
    }

    await sleep(pollMs);
    await pollOnce();
  };

  await pollOnce();
}

async function processOneUpload(upload) {
  const supabase = getSupabase();
  if (!supabase) return;

  let buffer;
  try {
    buffer = await downloadEssayBuffer(upload);
  } catch (err) {
    console.error('[essayUploadPoller] download failed:', {
      uploadId: upload.id,
      file_name: upload.file_name,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    await markFailed(
      upload,
      `download: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  console.log('[essayUploadPoller] essay downloaded', {
    uploadId: upload.id,
    file_name: upload.file_name,
    mime_type: upload.mime_type,
    byteLength: buffer.length,
  });

  let submission;
  try {
    submission = await mplag.submitFile(
      buffer,
      upload.file_name,
      upload.mime_type
    );
  } catch (err) {
    console.error('[essayUploadPoller] submit failed:', {
      uploadId: upload.id,
      file_name: upload.file_name,
      byteLength: buffer.length,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    await markFailed(
      upload,
      `submit: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  const submissionId = submission.id;
  console.log('[essayUploadPoller] submitted to MyPlag', {
    uploadId: upload.id,
    submissionId,
    responseKeys:
      submission && typeof submission === 'object'
        ? Object.keys(submission)
        : undefined,
  });

  const { error: saveSubmitError } = await supabase
    .from('essay_uploads')
    .update({
      submission_id: submissionId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', upload.id);

  if (saveSubmitError) {
    console.error(
      '[essayUploadPoller] save submission_id failed:',
      supabaseErrDetail(saveSubmitError)
    );
    await markFailed(upload, `db: ${saveSubmitError.message}`);
    return;
  }

  console.log('[essayUploadPoller] submission_id persisted', {
    uploadId: upload.id,
    submissionId,
  });

  await waitForMyPlagResult(supabase, upload, submissionId);
}

let timer;
let busy = false;

function startEssayUploadPoller(options = {}) {
  const intervalMs =
    options.intervalMs !== undefined && options.intervalMs !== null
      ? options.intervalMs
      : DEFAULT_INTERVAL_MS;

  if (!getSupabase()) {
    console.warn(
      '[essayUploadPoller] Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY); poller disabled'
    );
    return;
  }
  if (!config.mplagBaseUrl || !config.mplagApiKey) {
    console.warn(
      '[essayUploadPoller] MyPlag API not configured (MPLAG_BASE_URL / MPLAG_API_KEY); poller disabled'
    );
    return;
  }

  console.log('[essayUploadPoller] poller started', {
    intervalMs,
    defaultIntervalMs: DEFAULT_INTERVAL_MS,
    mplagBaseUrl: config.mplagBaseUrl,
    mplagApiKeyConfigured: Boolean(config.mplagApiKey),
    mplagStatusPollMs: config.mplagStatusPollMs ?? DEFAULT_INTERVAL_MS,
    mplagMaxWaitMs: config.mplagMaxWaitMs ?? DEFAULT_MAX_WAIT_MS,
  });

  async function runTick() {
    if (busy) {
      console.warn(
        '[essayUploadPoller] tick skipped: previous tick still in progress'
      );
      return;
    }
    busy = true;
    const tickStartedAt = Date.now();
    try {
      const next = await claimNextEssayUpload();
      if (next) {
        console.log('[essayUploadPoller] claimed essay_upload', {
          id: next.id,
          file_name: next.file_name,
          mime_type: next.mime_type,
          created_at: next.created_at,
        });
        await processOneUpload(next);
        console.log(
          '[essayUploadPoller] tick completed after processing upload',
          {
            id: next.id,
            elapsedMs: Date.now() - tickStartedAt,
          }
        );
      } else {
        console.log('[essayUploadPoller] tick idle (no queued paid upload)', {
          elapsedMs: Date.now() - tickStartedAt,
        });
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error('[essayUploadPoller] tick error:', {
        message: err.message,
        stack: err.stack,
        name: err.name,
        cause: err.cause,
      });
    } finally {
      busy = false;
    }
  }

  console.log(
    `[essayUploadPoller] first tick runs now; subsequent ticks every ${intervalMs}ms`
  );
  runTick();
  timer = setInterval(runTick, intervalMs);
}

function stopEssayUploadPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startEssayUploadPoller, stopEssayUploadPoller };
