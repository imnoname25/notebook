package ru.metroom.notebook;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import static org.junit.Assert.*;

public class NotebookShareSyncTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private final NotebookShareServer server = NotebookShareServer.parse("https://notes.example.test/base");
    private final NotebookShareSync.Account owner = new NotebookShareSync.Account(server, "owner", "Owner");

    private NotebookShareRecord capture(NotebookShareStore store) throws IOException {
        return store.capture(UUID.randomUUID(), 1, "A note", "Text", "", List.of(), server, null);
    }

    @Test public void cannotSendUntilExplicitlyBoundAndCannotChangeRecipient() throws Exception {
        var store = new NotebookShareStore(temp.newFolder(), new NotebookShareStoreTest.TestDisk());
        var item = capture(store);
        item.status = NotebookShareRecord.Status.QUEUED;
        assertFalse(NotebookShareSync.due(item, owner, 0));
        NotebookShareSync.bind(item, owner);
        assertTrue(NotebookShareSync.due(item, owner, 0));
        var other = new NotebookShareSync.Account(server, "other", "Other");
        var sameOriginDifferentBase = new NotebookShareSync.Account(NotebookShareServer.parse("https://notes.example.test/elsewhere"), "owner", "Owner");
        assertFalse(NotebookShareSync.due(item, other, 0));
        assertFalse(NotebookShareSync.due(item, sameOriginDifferentBase, 0));
        assertThrows(IllegalStateException.class, () -> NotebookShareSync.bind(item, other));
        assertThrows(IllegalStateException.class, () -> NotebookShareSync.bind(item, sameOriginDifferentBase));
        assertFalse(NotebookShareSync.due(item, null, 0));
        assertEquals(server, NotebookShareServer.fromLaunch("https://NOTES.EXAMPLE.TEST:443/base/app?client=android"));
        assertTrue(server.ownsPage("https://notes.example.test/base/login"));
        assertFalse(server.ownsPage("https://notes.example.test/base-other/app"));
        assertFalse(server.ownsPage("https://different.example.test/base/app"));
    }

    @Test public void reusesTheOperationAfterLostResponseAndRestart() throws Exception {
        var directory = temp.newFolder();
        var store = new NotebookShareStore(directory, new NotebookShareStoreTest.TestDisk());
        var item = capture(store);
        NotebookShareSync.bind(item, owner);
        item.status = NotebookShareRecord.Status.QUEUED;
        store.update(item);
        var serverWrites = new HashMap<String, String>();
        assertFalse(NotebookShareSync.submit(store, item, owner, 1, pending -> {
            serverWrites.put(pending.key(), "saved-material");
            throw new IOException("lost HTTP response");
        }));
        var restarted = new NotebookShareStore(directory, new NotebookShareStoreTest.TestDisk());
        restarted.recover();
        var retry = restarted.read(item.id);
        assertEquals(NotebookShareRecord.Status.RETRY, retry.status);
        assertFalse(NotebookShareSync.due(retry, owner, retry.retryAt - 1));
        assertTrue(NotebookShareSync.submit(restarted, retry, owner, retry.retryAt, pending -> {
            assertEquals(item.key(), pending.key());
            return new NotebookShareSync.Result(200, serverWrites.get(pending.key()), 0);
        }));
        assertEquals(1, serverWrites.size());
        assertNull(restarted.read(item.id));
    }

    @Test public void distinguishesSessionAccessConflictLimitsAndInvalidSuccess() throws Exception {
        var store = new NotebookShareStore(temp.newFolder(), new NotebookShareStoreTest.TestDisk());
        var item = capture(store);
        NotebookShareSync.bind(item, owner);
        int[] codes = {401, 403, 409, 413, 200, 500, 429};
        var states = List.of(NotebookShareRecord.Status.AUTH, NotebookShareRecord.Status.ACCESS,
                NotebookShareRecord.Status.CONFLICT, NotebookShareRecord.Status.TOO_LARGE, NotebookShareRecord.Status.RETRY,
                NotebookShareRecord.Status.RETRY, NotebookShareRecord.Status.RETRY);
        for (int index = 0; index < codes.length; index++) {
            NotebookShareSync.apply(item, new NotebookShareSync.Result(codes[index], null, 600_000), 1);
            assertEquals(states.get(index), item.status);
            assertEquals("", item.remoteId);
        }
        assertEquals(300_001, item.retryAt);
        for (int i = 0; i < NotebookShareSync.MAX_ATTEMPTS; i++) {
            NotebookShareSync.apply(item, new NotebookShareSync.Result(503, null, 0), 1);
        }
        assertEquals(NotebookShareRecord.Status.ERROR, item.status);
        assertFalse(NotebookShareSync.due(item, owner, Long.MAX_VALUE));
    }
}
