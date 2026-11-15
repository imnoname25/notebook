package ru.metroom.notebook;

import android.content.Context;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.Operation;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import org.json.JSONException;

/** WorkManager carries record IDs. Source URLs, payloads and cookies stay outside its database. */
public final class NotebookPreviewWorker extends Worker {
    private static final int MAX_ATTEMPTS = 3;
    private static final Semaphore CAPTURE_SLOTS = new Semaphore(2);
    private final NotebookPreviewNetwork network = new NotebookPreviewNetwork();
    private final NotebookShareHttp http = new NotebookShareHttp(20);

    public NotebookPreviewWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    record Job(UUID id, Operation operation) {}

    static Job enqueue(Context context, NotebookShareServer server, String account, String id, boolean explicit) {
        String uniqueName = uniqueName(server, account, id);
        UUID operation = explicit ? UUID.randomUUID() : UUID.nameUUIDFromBytes(uniqueName.getBytes(StandardCharsets.UTF_8));
        var request = new OneTimeWorkRequest.Builder(NotebookPreviewWorker.class)
                .setId(operation)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 20, TimeUnit.SECONDS)
                .setInputData(new Data.Builder().putString("server", server.base).putString("account", account)
                        .putString("item", id).build())
                .build();
        var scheduled = WorkManager.getInstance(context).enqueueUniqueWork(uniqueName,
                explicit ? ExistingWorkPolicy.REPLACE : ExistingWorkPolicy.KEEP, request);
        return new Job(operation, scheduled);
    }

    static String uniqueName(NotebookShareServer server, String account, String id) {
        UUID target = UUID.nameUUIDFromBytes((server.base + "\n" + account + "\n" + id).getBytes(StandardCharsets.UTF_8));
        return "saved-preview-" + target;
    }

    static Operation enqueueDraft(Context context, UUID id, boolean deliver) {
        var builder = new OneTimeWorkRequest.Builder(NotebookPreviewWorker.class)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS)
                .setInputData(new Data.Builder().putString("draft", id.toString()).putBoolean("deliver", deliver).build());
        if (!deliver && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST);
        }
        return WorkManager.getInstance(context).enqueueUniqueWork(
                draftWork(id, deliver), ExistingWorkPolicy.KEEP, builder.build());
    }

    static void cancelDraft(Context context, UUID id) {
        WorkManager manager = WorkManager.getInstance(context);
        manager.cancelUniqueWork(draftWork(id, false));
        manager.cancelUniqueWork(draftWork(id, true));
    }

    private static String draftWork(UUID id, boolean deliver) {
        return (deliver ? "deliver-preview-" : "capture-preview-") + id;
    }

    @NonNull @Override public Result doWork() {
        String draft = getInputData().getString("draft");
        if (draft != null) return draftPreview(UUID.fromString(draft), getInputData().getBoolean("deliver", false));
        String id = getInputData().getString("item"), expected = getInputData().getString("account");
        NotebookShareServer server = NotebookShareServer.parse(getInputData().getString("server"));
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,128}") || expected == null || server == null) return Result.failure();
        NotebookShareManager shares = NotebookShareManager.get(getApplicationContext());
        try {
            String cookie = shares.previewCookie(server);
            if (isStopped() || cookie == null) return unavailable("Войдите в нужный аккаунт, чтобы обновить превью");
            var account = http.account(server, cookie);
            if (account == null || !expected.equals(account.id) || !cookie.equals(shares.previewCookie(server))) {
                return unavailable("Войдите в нужный аккаунт, чтобы обновить превью");
            }
            String source = http.previewSource(server, cookie, id);
            if (source == null || isStopped()) return unavailable("Сервер не поддерживает обновление превью с устройства");
            NotebookLinkPreview.Result preview = new NotebookLinkPreview(network::read).get(source);
            if (isStopped() || !cookie.equals(shares.previewCookie(server))) {
                return unavailable("Сессия изменилась во время обновления превью");
            }
            if (preview.title() == null && preview.description() == null && preview.siteName() == null && preview.image() == null) {
                return unavailable("Источник не предоставил превью");
            }
            int status = http.uploadPreview(server, cookie, id, getId().toString(), preview);
            if (status == 413 || status == 415) {
                if (preview.image() == null || (preview.title() == null && preview.description() == null && preview.siteName() == null)) {
                    return unavailable("Обложка недоступна");
                }
                // Retrying with text alone preserves useful metadata if the server rejects the raster.
                var textOnly = new NotebookLinkPreview.Result(preview.kind(), preview.title(), preview.description(), preview.siteName(), null, null);
                if (isStopped() || !cookie.equals(shares.previewCookie(server))) return Result.failure();
                status = http.uploadPreview(server, cookie, id, getId() + "-text", textOnly);
            }
            // A repeated request can return conflict after a lost response and a changed public preview.
            // The original operation has already been applied for this work ID.
            if (status == 204 || status == 409) return Result.success();
            if (status == 429 || status == 408 || status >= 500) return retryOrFail();
            if (status == 401 || status == 403) return unavailable("Войдите в нужный аккаунт, чтобы обновить превью");
            return unavailable("Не удалось сохранить превью с устройства");
        } catch (NotebookPreviewNetwork.Unavailable failure) {
            if (failure.restricted) return unavailable("Источник ограничил доступ к превью");
            return failure.retryable ? retryOrFail() : unavailable("Превью источника недоступно");
        } catch (IOException failure) {
            return retryOrFail();
        }
    }

    private Result draftPreview(UUID id, boolean deliver) {
        var shares = NotebookShareManager.get(getApplicationContext());
        var store = shares.captureStore();
        try {
            var entry = store.read(id);
            if (entry == null || !entry.androidFirst || isStopped()) return Result.success();
            if (!deliver) {
                if (store.hasPreview(id)) return Result.success();
                if (!CAPTURE_SLOTS.tryAcquire()) return Result.retry();
                try {
                    var captured = capture(entry.url);
                    if (!isStopped()) store.savePreview(id, captured);
                } finally { CAPTURE_SLOTS.release(); }
                return Result.success();
            }
            if (entry.status != NotebookShareRecord.Status.SENT || !entry.remoteId.matches("[A-Za-z0-9_-]{1,128}")) return Result.failure();
            var preview = store.preview(id);
            if (preview == null) {
                if (getRunAttemptCount() < 5) {
                    enqueueDraft(getApplicationContext(), id, false);
                    return Result.retry();
                }
                return Result.failure();
            }
            var server = NotebookShareServer.parse(entry.server);
            String cookie = server == null ? null : shares.previewCookie(server);
            var account = cookie == null ? null : http.account(server, cookie);
            if (account == null || !entry.accountId.equals(account.id) || !cookie.equals(shares.previewCookie(server)) || isStopped()) {
                return retryOrFail();
            }
            int status = deliver(server, cookie, entry, preview, false);
            if (status == 404 || status == 405) {
                try {
                    if (entry.url.equals(http.previewSource(server, cookie, entry.remoteId))) {
                        status = deliver(server, cookie, entry, preview, true);
                    } else status = 204; // Server predates the preview API.
                } catch (NotebookPreviewNetwork.Unavailable missing) {
                    if (missing.retryable) throw missing;
                    status = 204; // The remote item no longer accepts previews.
                }
            }
            if (status == 204) {
                store.remove(id);
                return Result.success();
            }
            if (status == 400 || status == 422) {
                // Keep the confirmed bookmark and let the server run fallback.
                int settled = http.uploadCapture(server, cookie, entry, NotebookCapturedPreview.unavailable("invalid"), false);
                if (settled == 204) {
                    store.remove(id);
                    return Result.success();
                }
            }
            return retryOrFail();
        } catch (IOException | JSONException failure) {
            return retryOrFail();
        }
    }

    private NotebookCapturedPreview capture(String source) throws JSONException {
        try {
            return NotebookCapturedPreview.success(new NotebookLinkPreview(network::read).get(source, true));
        } catch (NotebookPreviewNetwork.Unavailable failure) {
            return NotebookCapturedPreview.unavailable(failure.restricted ? "access" : failure.retryable ? "network" : "extraction");
        } catch (IOException failure) {
            return NotebookCapturedPreview.unavailable("network");
        }
    }

    private int deliver(NotebookShareServer server, String cookie, NotebookShareRecord entry, NotebookCapturedPreview preview,
                        boolean legacy) throws IOException, JSONException {
        int status = http.uploadCapture(server, cookie, entry, preview, legacy);
        return (status == 413 || status == 415) && preview.cover() != null && !isStopped()
                ? http.uploadCapture(server, cookie, entry, preview.withoutCover(), legacy) : status;
    }

    private Result retryOrFail() {
        return !isStopped() && getRunAttemptCount() + 1 < MAX_ATTEMPTS
                ? Result.retry() : unavailable("Не удалось получить превью с устройства");
    }

    private static Result unavailable(String message) {
        return Result.failure(new Data.Builder().putString("message", message).build());
    }

    @Override public void onStopped() {
        network.cancel();
        http.cancel();
    }
}
