package ru.metroom.notebook;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
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
import java.util.concurrent.TimeUnit;

/** Stores only the destination and receipt. Source URLs and session cookies never enter WorkManager. */
public final class NotebookPreviewWorker extends Worker {
    private static final int MAX_ATTEMPTS = 3;
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

    @NonNull @Override public Result doWork() {
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
