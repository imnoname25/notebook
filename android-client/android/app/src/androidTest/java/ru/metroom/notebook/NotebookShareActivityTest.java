package ru.metroom.notebook;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.IOException;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NotebookShareActivityTest {
    @Test public void capturesColdAndWarmIntentsWithoutExposingTheirExtrasToCapacitor() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        var context = instrumentation.getTargetContext();
        var queue = new NotebookShareStore(new File(context.getNoBackupFilesDir(), "saved-share-queue"), new NotebookShareDisk());
        String cold = "Test cold share " + UUID.randomUUID();
        String warm = "Test warm share " + UUID.randomUUID();
        try (var scenario = ActivityScenario.<MainActivity>launch(share(context, cold))) {
            var first = waitFor(queue, cold);
            scenario.onActivity(activity -> assertEquals(Intent.ACTION_MAIN, activity.getIntent().getAction()));
            instrumentation.runOnMainSync(() -> context.startActivity(share(context, warm)));
            var second = waitFor(queue, warm);
            assertNotEquals(first.id, second.id);
            scenario.onActivity(activity -> {
                assertEquals(Intent.ACTION_MAIN, activity.getIntent().getAction());
                assertFalse(activity.getIntent().hasExtra(Intent.EXTRA_TEXT));
            });
            scenario.recreate();
            assertEquals(1, queue.list().stream().filter(item -> item.text.equals(cold)).count());
            assertEquals(1, queue.list().stream().filter(item -> item.text.equals(warm)).count());
        } finally {
            for (var item : queue.list()) if (item.text.equals(cold) || item.text.equals(warm)) queue.remove(item.id);
        }
    }

    private static Intent share(Context context, String text) {
        return new Intent(Intent.ACTION_SEND).setClass(context, MainActivity.class)
                .setType("text/plain").putExtra(Intent.EXTRA_TEXT, text).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private static NotebookShareRecord waitFor(NotebookShareStore queue, String marker) throws IOException {
        for (int attempt = 0; attempt < 100; attempt++) {
            for (var item : queue.list()) if (item.text.equals(marker)) return item;
            SystemClock.sleep(100);
        }
        throw new AssertionError("The activity did not persist the test share");
    }
}
