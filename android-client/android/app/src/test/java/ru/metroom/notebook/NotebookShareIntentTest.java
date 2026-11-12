package ru.metroom.notebook;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import java.util.ArrayList;
import java.util.Arrays;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, manifest = Config.NONE)
public class NotebookShareIntentTest {
    private static final String OWN = "ru.metroom.notebook";

    @Test public void acceptsTextAndPreservesContextAroundYouTubeLink() {
        var intent = new Intent(Intent.ACTION_SEND).setType("text/plain");
        intent.putExtra(Intent.EXTRA_TEXT, "Посмотри: https://youtu.be/demo?t=42");
        intent.putExtra(Intent.EXTRA_SUBJECT, "Видео");
        intent.putExtra(Intent.EXTRA_TITLE, "Заголовок из приложения");
        assertTrue(NotebookShareIntent.accepts(intent));
        var share = NotebookShareIntent.parse(intent, OWN);
        assertEquals("Видео", share.subject);
        assertEquals("Заголовок из приложения", share.extraTitle);
        assertEquals("https://youtu.be/demo?t=42", share.url);
        assertEquals("Посмотри: https://youtu.be/demo?t=42", share.text);
        assertTrue(share.files.isEmpty());
        intent.putExtra(Intent.EXTRA_TEXT, "https://example.org/notes");
        share = NotebookShareIntent.parse(intent, OWN);
        assertEquals("https://example.org/notes", share.url);
        assertEquals("", share.text);
        intent.putExtra(Intent.EXTRA_TEXT, "Обычный текст");
        assertEquals("Обычный текст", NotebookShareIntent.parse(intent, OWN).text);
        assertFalse(NotebookShareIntent.accepts(new Intent(Intent.ACTION_MAIN)));
    }

    @Test public void collectsSingleAndMixedStreamsWithoutDuplicatingClipData() {
        Uri image = Uri.parse("content://sender/photos/1");
        Uri pdf = Uri.parse("content://sender/docs/2");
        var single = new Intent(Intent.ACTION_SEND).setType("application/pdf")
                .putExtra(Intent.EXTRA_STREAM, pdf).setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        assertEquals(Arrays.asList(pdf), NotebookShareIntent.parse(single, OWN).files);
        var multiple = new Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*");
        multiple.putParcelableArrayListExtra(Intent.EXTRA_STREAM, new ArrayList<>(Arrays.asList(image, pdf)));
        multiple.setClipData(ClipData.newRawUri("duplicate", image));
        assertEquals(Arrays.asList(image, pdf), NotebookShareIntent.parse(multiple, OWN).files);
    }

    @Test public void rejectsExternalFilePathsOwnProviderAndOverlongShares() {
        for (String bad : Arrays.asList("file:///tmp/a.pdf", "https://example.org/a.pdf", "content://ru.metroom.notebook.fileprovider/a")) {
            var intent = new Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM, Uri.parse(bad));
            assertThrows(IllegalArgumentException.class, () -> NotebookShareIntent.parse(intent, OWN));
        }
        var multiple = new Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*");
        var streams = new ArrayList<Uri>();
        for (int i = 0; i < 5; i++) streams.add(Uri.parse("content://sender/files/" + i));
        multiple.putParcelableArrayListExtra(Intent.EXTRA_STREAM, streams);
        assertThrows(IllegalArgumentException.class, () -> NotebookShareIntent.parse(multiple, OWN));
        var longText = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "x".repeat(50_001));
        assertThrows(IllegalArgumentException.class, () -> NotebookShareIntent.parse(longText, OWN));
    }
}
