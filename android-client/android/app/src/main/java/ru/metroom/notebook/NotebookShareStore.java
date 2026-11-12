package ru.metroom.notebook;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Properties;
import java.util.UUID;

final class NotebookShareStore {
    interface Source { String name(); InputStream open() throws IOException; }
    interface Disk { void rename(File source, File target) throws IOException; void sync(File directory) throws IOException; }

    private static final String DATA = "entry.properties";
    private static final int MAX_RECORDS = 50;
    private static final long MAX_QUEUE_BYTES = 256L * 1024 * 1024;
    private final File root;
    private final Disk disk;

    NotebookShareStore(File root, Disk disk) {
        this.root = root;
        this.disk = disk;
    }

    synchronized void recover() throws IOException {
        ensureRoot();
        for (File directory : children(root)) {
            String name = directory.getName();
            if (name.startsWith(".incoming-") || name.startsWith(".removed-")) {
                erase(directory);
            } else {
                UUID id = parseId(name);
                if (id == null) continue;
                NotebookShareRecord entry = read(id);
                if (entry != null && entry.status == NotebookShareRecord.Status.SENT) remove(entry.id);
            }
        }
    }

    NotebookShareRecord capture(UUID id, long receivedAt, String title, String text, String url,
                                List<Source> sources, NotebookShareServer selected, NotebookShareSync.Account account) throws IOException {
        if (sources.size() > NotebookShareInput.MAX_FILES) throw new IllegalArgumentException("Можно принять не больше четырёх файлов.");
        if (sources.isEmpty() && text.trim().isEmpty() && url.isEmpty()) throw new IllegalArgumentException("Материал пуст.");
        long remaining;
        synchronized (this) {
            ensureRoot();
            List<NotebookShareRecord> pending = list();
            remaining = MAX_QUEUE_BYTES;
            for (NotebookShareRecord entry : pending) for (var file : entry.files) remaining -= file.size;
            if (pending.size() >= MAX_RECORDS) throw new IllegalArgumentException("Очередь заполнена. Отправьте или удалите старые материалы.");
        }
        File stage = new File(root, ".incoming-" + id);
        if (!stage.mkdir()) throw new IOException("Could not create staging directory");
        try {
            var files = new ArrayList<NotebookShareRecord.Attachment>();
            long total = 0;
            for (int index = 0; index < sources.size(); index++) {
                var file = copy(sources.get(index), file(stage, index), index,
                        Math.min(NotebookShareInput.MAX_TOTAL_BYTES, remaining) - total);
                files.add(file);
                total += file.size;
            }
            var kind = files.isEmpty() ? (url.isEmpty() ? NotebookShareRecord.Kind.TEXT : NotebookShareRecord.Kind.LINK)
                    : text.isEmpty() && url.isEmpty() ? NotebookShareRecord.Kind.FILES : NotebookShareRecord.Kind.MIXED;
            var entry = new NotebookShareRecord(id, receivedAt, kind, title, text, url, files);
            if (selected != null) entry.server = selected.base;
            if (account != null && account.server.equals(selected)) {
                entry.accountId = account.id;
                entry.accountName = account.name;
            }
            write(stage, entry);
            synchronized (this) {
                File destination = directory(id);
                if (destination.exists()) throw new IOException("Share already exists");
                disk.rename(stage, destination);
                disk.sync(root);
            }
            return entry;
        } finally {
            erase(stage);
        }
    }

    private NotebookShareRecord.Attachment copy(Source source, File target, int index, long remaining) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        byte[] signature = new byte[12];
        int prefix = 0;
        long size = 0;
        try (InputStream in = source.open(); FileOutputStream out = new FileOutputStream(target)) {
            for (int read; (read = in.read(buffer)) != -1; ) {
                if (read == 0) continue;
                size += read;
                if (size > NotebookShareInput.MAX_FILE_BYTES || size > remaining) {
                    throw new IllegalArgumentException("Превышен размер файла, материала или локальной очереди.");
                }
                if (prefix < signature.length) {
                    int take = Math.min(signature.length - prefix, read);
                    System.arraycopy(buffer, 0, signature, prefix, take);
                    prefix += take;
                    if (prefix == signature.length && NotebookShareInput.mime(signature, prefix) == null) {
                        throw new IllegalArgumentException("Этот формат вложения не поддерживается.");
                    }
                }
                out.write(buffer, 0, read);
            }
            String mime = NotebookShareInput.mime(signature, prefix);
            if (mime == null) throw new IllegalArgumentException("Поддерживаются JPEG, PNG, GIF, WebP, AVIF и PDF.");
            out.getFD().sync();
            return new NotebookShareRecord.Attachment(NotebookShareInput.filename(source.name(), index), mime, size);
        }
    }

    synchronized List<NotebookShareRecord> list() throws IOException {
        ensureRoot();
        var result = new ArrayList<NotebookShareRecord>();
        for (File directory : children(root)) {
            UUID id = parseId(directory.getName());
            if (id == null) continue;
            var entry = read(id);
            if (entry != null && entry.status != NotebookShareRecord.Status.SENT) result.add(entry);
        }
        result.sort(Comparator.comparingLong((NotebookShareRecord entry) -> entry.receivedAt).reversed());
        return result;
    }

    synchronized NotebookShareRecord read(UUID id) throws IOException {
        File directory = directory(id);
        if (!directory.exists()) return null;
        var props = new Properties();
        try (var reader = new InputStreamReader(new FileInputStream(new File(directory, DATA)), StandardCharsets.UTF_8)) {
            props.load(reader);
            if (!"1".equals(props.getProperty("version"))) throw new IOException("Unsupported share queue version");
            int count = Integer.parseInt(props.getProperty("files"));
            if (count < 0 || count > NotebookShareInput.MAX_FILES) throw new IOException("Invalid attachment count");
            var files = new ArrayList<NotebookShareRecord.Attachment>();
            for (int i = 0; i < count; i++) {
                String key = "file." + i + ".";
                files.add(new NotebookShareRecord.Attachment(props.getProperty(key + "name"),
                        props.getProperty(key + "mime"), Long.parseLong(props.getProperty(key + "size"))));
            }
            var entry = new NotebookShareRecord(id, Long.parseLong(props.getProperty("receivedAt")),
                    NotebookShareRecord.Kind.valueOf(props.getProperty("kind")), props.getProperty("title", ""),
                    props.getProperty("text", ""), props.getProperty("url", ""), files);
            entry.comment = props.getProperty("comment", "");
            String tags = props.getProperty("tags", "");
            if (!tags.isEmpty()) entry.tags = Arrays.asList(tags.split(","));
            entry.server = props.getProperty("server", "");
            entry.accountId = props.getProperty("accountId", "");
            entry.accountName = props.getProperty("accountName", "");
            entry.status = NotebookShareRecord.Status.valueOf(props.getProperty("status"));
            entry.attempts = Integer.parseInt(props.getProperty("attempts", "0"));
            entry.retryAt = Long.parseLong(props.getProperty("retryAt", "0"));
            entry.remoteId = props.getProperty("remoteId", "");
            return entry;
        } catch (IllegalArgumentException | NullPointerException invalid) {
            throw new IOException("Invalid share queue record", invalid);
        }
    }

    synchronized void update(NotebookShareRecord entry) throws IOException {
        if (!directory(entry.id).isDirectory()) throw new IOException("Share not found");
        write(directory(entry.id), entry);
    }

    private void write(File directory, NotebookShareRecord entry) throws IOException {
        var props = new Properties();
        props.setProperty("version", "1");
        props.setProperty("receivedAt", Long.toString(entry.receivedAt));
        props.setProperty("kind", entry.kind.name());
        props.setProperty("title", entry.title);
        props.setProperty("text", entry.text);
        props.setProperty("url", entry.url);
        props.setProperty("comment", entry.comment);
        props.setProperty("tags", entry.tags.stream().collect(java.util.stream.Collectors.joining(",")));
        props.setProperty("server", entry.server);
        props.setProperty("accountId", entry.accountId);
        props.setProperty("accountName", entry.accountName);
        props.setProperty("status", entry.status.name());
        props.setProperty("attempts", Integer.toString(entry.attempts));
        props.setProperty("retryAt", Long.toString(entry.retryAt));
        props.setProperty("remoteId", entry.remoteId);
        props.setProperty("files", Integer.toString(entry.files.size()));
        for (int index = 0; index < entry.files.size(); index++) {
            var file = entry.files.get(index);
            String key = "file." + index + ".";
            props.setProperty(key + "name", file.name);
            props.setProperty(key + "mime", file.mime);
            props.setProperty(key + "size", Long.toString(file.size));
        }
        File temporary = new File(directory, DATA + ".new");
        try {
            try (var out = new FileOutputStream(temporary); var writer = new OutputStreamWriter(out, StandardCharsets.UTF_8)) {
                props.store(writer, null);
                writer.flush();
                out.getFD().sync();
            }
            disk.rename(temporary, new File(directory, DATA));
            disk.sync(directory);
        } finally {
            temporary.delete();
        }
    }

    synchronized void remove(UUID id) throws IOException {
        File directory = directory(id);
        if (!directory.exists()) return;
        File removed = new File(root, ".removed-" + id);
        disk.rename(directory, removed);
        disk.sync(root);
        erase(removed);
    }

    File attachment(NotebookShareRecord entry, int index) throws IOException {
        File file = file(directory(entry.id), index);
        if (!file.isFile() || file.length() != entry.files.get(index).size) throw new IOException("Share attachment is incomplete");
        return file;
    }

    private File directory(UUID id) { return new File(root, id.toString()); }
    private static File file(File directory, int index) { return new File(directory, "file-" + index); }
    private void ensureRoot() throws IOException {
        if (root.isDirectory()) return;
        if (!root.mkdirs()) throw new IOException("Could not open share queue");
        disk.sync(root.getParentFile());
    }
    private static UUID parseId(String name) {
        try {
            UUID id = UUID.fromString(name);
            return id.toString().equals(name) ? id : null;
        } catch (IllegalArgumentException ignored) { return null; }
    }
    private static File[] children(File directory) throws IOException {
        File[] files = directory.listFiles();
        if (files == null) throw new IOException("Could not list share queue");
        return files;
    }
    private static void erase(File entry) {
        File[] children = entry.listFiles();
        if (children != null) for (File child : children) erase(child);
        entry.delete();
    }
}
