package ru.metroom.notebook;

import androidx.webkit.WebViewFeature;
import androidx.lifecycle.Observer;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The bridge accepts item IDs from the selected app and exposes no files or credentials. */
@CapacitorPlugin(name = "NotebookShare")
public class NotebookSharePlugin extends Plugin {
    @PluginMethod
    public void showQueue(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            var bridge = getBridge();
            var manager = NotebookShareManager.get(getContext());
            if (!(getActivity() instanceof MainActivity)
                    || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                    || bridge.getConfig().isUsingLegacyBridge()
                    || !manager.allowsQueue(bridge.getWebView().getUrl(), bridge.getLocalUrl())) {
                call.reject("Откройте очередь через ярлык приложения.");
                return;
            }
            ((MainActivity) getActivity()).showShareQueue();
            call.resolve();
        });
    }

    @PluginMethod
    public void refreshPreview(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!previewBridgeAvailable()) {
                call.reject("Обновление доступно в приложении Notebook");
                return;
            }
            try {
                var manager = NotebookShareManager.get(getContext());
                var job = manager.updatePreview(getBridge().getWebView().getUrl(), call.getString("id"));
                if (job == null) {
                    call.reject("Дождитесь проверки сессии Notebook и повторите");
                    return;
                }
                var main = androidx.core.content.ContextCompat.getMainExecutor(getContext());
                var scheduled = job.operation().getResult();
                scheduled.addListener(() -> {
                    try {
                        scheduled.get();
                        observePreview((MainActivity) getActivity(), job, call);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                        call.reject("Обновление превью прервано");
                    } catch (java.util.concurrent.ExecutionException failure) {
                        call.reject("Не удалось запланировать обновление превью");
                    }
                }, main);
            } catch (RuntimeException failure) {
                call.reject("Не удалось запланировать обновление превью");
            }
        });
    }

    private static void observePreview(MainActivity activity, NotebookPreviewWorker.Job job, PluginCall call) {
        var info = WorkManager.getInstance(activity).getWorkInfoByIdLiveData(job.id());
        info.observe(activity, new Observer<WorkInfo>() {
            @Override public void onChanged(WorkInfo work) {
                if (work != null && !work.getState().isFinished()) return;
                info.removeObserver(this);
                if (work != null && work.getState() == WorkInfo.State.SUCCEEDED) {
                    call.resolve(new JSObject().put("updated", true));
                } else if (work != null && work.getState() == WorkInfo.State.CANCELLED) {
                    call.resolve(new JSObject().put("updated", false));
                } else {
                    String message = work == null ? null : work.getOutputData().getString("message");
                    call.reject(message == null ? "Не удалось обновить превью" : message);
                }
            }
        });
    }

    @PluginMethod
    public void cancelPreview(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (previewBridgeAvailable() && NotebookShareManager.get(getContext())
                        .cancelPreview(getBridge().getWebView().getUrl(), call.getString("id"))) {
                    call.resolve();
                    return;
                }
            } catch (RuntimeException ignored) { /* The current session no longer controls this job. */ }
            call.reject("Не удалось отменить обновление превью");
        });
    }

    private boolean previewBridgeAvailable() {
        return getActivity() instanceof MainActivity
                && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                && !getBridge().getConfig().isUsingLegacyBridge();
    }
}
