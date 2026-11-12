package ru.metroom.notebook;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import static org.junit.Assert.*;

public class NotebookShareStoreTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    static class TestDisk implements NotebookShareStore.Disk {
        @Override public void rename(File source, File target) throws IOException {
            Files.move(source.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        }
        @Override public void sync(File directory) {}
    }

    static NotebookShareStore.Source source(String name, byte[] data) {
        return new NotebookShareStore.Source() {
            @Override public String name() { return name; }
            @Override public InputStream open() { return new ByteArrayInputStream(data); }
        };
    }

    @Test public void copiesFilesAndRestoresRecordAfterReopeningTheStore() throws Exception {
        var directory = temp.newFolder();
        var store = new NotebookShareStore(directory, new TestDisk());
        UUID id = UUID.randomUUID();
        var server = NotebookShareServer.parse("https://notes.example.test/base");
        var account = new NotebookShareSync.Account(server, "owner", "Владелец");
        byte[] pdf = "%PDF-1.7\n%%EOF".getBytes(StandardCharsets.US_ASCII);
        byte[] gif = "GIF89a-data".getBytes(StandardCharsets.US_ASCII);
        var item = store.capture(id, 42, "Билеты", "Исходный текст", "", List.of(
                source("../../билеты.pdf", pdf), source("preview.png", gif)), server, account);
        assertEquals(NotebookShareRecord.Kind.MIXED, item.kind);
        assertEquals("image/gif", item.files.get(1).mime);
        assertFalse(item.files.get(0).name.contains("/"));
        item.comment = "Комментарий";
        item.tags = List.of("поездка");
        item.status = NotebookShareRecord.Status.QUEUED;
        store.update(item);
        var reopened = new NotebookShareStore(directory, new TestDisk());
        reopened.recover();
        var saved = reopened.read(id);
        assertEquals(id.toString(), saved.key());
        assertEquals("owner", saved.accountId);
        assertEquals(server.base, saved.server);
        assertEquals("Исходный текст\n\nКомментарий", saved.payloadText());
        assertEquals(List.of("поездка"), saved.tags);
        assertEquals(42, saved.receivedAt);
        assertArrayEquals(pdf, Files.readAllBytes(reopened.attachment(saved, 0).toPath()));
    }

    @Test public void rejectsUnsupportedOversizedAndPartlyCopiedFiles() throws Exception {
        var directory = temp.newFolder();
        var store = new NotebookShareStore(directory, new TestDisk());
        byte[] oversized = new byte[(int) NotebookShareInput.MAX_FILE_BYTES + 1];
        System.arraycopy("%PDF-".getBytes(StandardCharsets.US_ASCII), 0, oversized, 0, 5);
        assertThrows(IllegalArgumentException.class, () -> store.capture(UUID.randomUUID(), 0, "", "", "",
                List.of(source("large.pdf", oversized)), null, null));
        assertThrows(IllegalArgumentException.class, () -> store.capture(UUID.randomUUID(), 0, "", "", "",
                List.of(source("fake.png", "<svg/>".getBytes(StandardCharsets.US_ASCII))), null, null));
        var interrupted = new NotebookShareStore.Source() {
            @Override public String name() { return "file.pdf"; }
            @Override public InputStream open() {
                return new InputStream() {
                    final byte[] bytes = "%PDF-1.7".getBytes(StandardCharsets.US_ASCII);
                    int index;
                    @Override public int read() throws IOException {
                        if (index == bytes.length) throw new IOException("interrupted");
                        return bytes[index++];
                    }
                };
            }
        };
        assertThrows(IOException.class, () -> store.capture(UUID.randomUUID(), 0, "", "", "", List.of(interrupted), null, null));
        assertTrue(store.list().isEmpty());
        var stage = new File(directory, ".incoming-" + UUID.randomUUID());
        assertTrue(stage.mkdir());
        Files.write(new File(stage, "file-0").toPath(), "partial".getBytes(StandardCharsets.UTF_8));
        store.recover();
        assertFalse(stage.exists());
        assertTrue(store.list().isEmpty());
    }

    @Test public void recoversAfterAcknowledgementBeforeFileCleanup() throws Exception {
        var directory = temp.newFolder();
        var store = new NotebookShareStore(directory, new TestDisk());
        var entry = store.capture(UUID.randomUUID(), 0, "", "Draft", "", Collections.emptyList(), null, null);
        entry.status = NotebookShareRecord.Status.SENT;
        entry.remoteId = "remote-item";
        store.update(entry);
        assertTrue(store.list().isEmpty());
        assertNotNull(store.read(entry.id));
        new NotebookShareStore(directory, new TestDisk()).recover();
        assertNull(store.read(entry.id));
    }
}
