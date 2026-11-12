package ru.metroom.notebook;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Process;
import android.provider.OpenableColumns;
import androidx.core.content.IntentCompat;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;

final class NotebookShareIntent {
    final String subject;
    final String extraTitle;
    final String text;
    final String url;
    final List<Uri> files;

    private NotebookShareIntent(String subject, String extraTitle, String text, String url, List<Uri> files) {
        this.subject = subject;
        this.extraTitle = extraTitle;
        this.text = text;
        this.url = url;
        this.files = files;
    }

    static boolean accepts(Intent intent) {
        return intent != null && (Intent.ACTION_SEND.equals(intent.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction()));
    }

    static NotebookShareIntent parse(Intent intent, String ownPackage) {
        boolean multiple = Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction());
        var files = new LinkedHashSet<Uri>();
        if (multiple) {
            var streams = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (streams != null) for (Uri uri : streams) addFile(files, uri, ownPackage);
        } else {
            addFile(files, IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class), ownPackage);
        }
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        ClipData clip = intent.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                ClipData.Item item = clip.getItemAt(i);
                addFile(files, item.getUri(), ownPackage);
                if (text == null && !multiple) text = item.getText();
            }
        }
        if (!multiple && files.size() > 1) throw new IllegalArgumentException("Для нескольких файлов нужен общий выбор файлов.");
        String original = NotebookShareInput.text(text);
        if (files.isEmpty() && (multiple || !"text/plain".equals(intent.getType()) || original.trim().isEmpty())) {
            throw new IllegalArgumentException("Поделитесь текстом, ссылкой, изображением или PDF.");
        }
        String url = NotebookShareInput.url(original);
        return new NotebookShareIntent(
                NotebookShareInput.title(intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)),
                NotebookShareInput.title(intent.getCharSequenceExtra(Intent.EXTRA_TITLE)),
                original.trim().equals(url) ? "" : original, url, new ArrayList<>(files));
    }

    private static void addFile(LinkedHashSet<Uri> files, Uri uri, String ownPackage) {
        if (uri == null) return;
        String authority = uri.getAuthority();
        String normalized = authority == null ? "" : authority.toLowerCase(Locale.ROOT);
        if (!"content".equals(uri.getScheme()) || !normalized.matches("[a-z0-9._-]{1,255}")
                || normalized.equals(ownPackage) || normalized.startsWith(ownPackage + ".")) {
            throw new IllegalArgumentException("Источник файла недоступен для безопасного чтения.");
        }
        files.add(uri);
        if (files.size() > NotebookShareInput.MAX_FILES) throw new IllegalArgumentException("Можно принять не больше четырёх файлов.");
    }

    List<NotebookShareStore.Source> sources(Context context) {
        var result = new ArrayList<NotebookShareStore.Source>();
        for (Uri uri : files) {
            if (context.checkUriPermission(uri, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    != PackageManager.PERMISSION_GRANTED) {
                throw new SecurityException("Android не предоставил доступ к файлу.");
            }
            result.add(new NotebookShareStore.Source() {
                @Override
                public String name() {
                    try (var cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                        return cursor != null && cursor.moveToFirst() ? cursor.getString(0) : null;
                    } catch (RuntimeException ignored) {
                        return null;
                    }
                }

                @Override
                public InputStream open() throws IOException {
                    InputStream stream = context.getContentResolver().openInputStream(uri);
                    if (stream == null) throw new IOException("File provider returned no stream");
                    return stream;
                }
            });
        }
        return result;
    }
}
