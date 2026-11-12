package ru.metroom.notebook;

import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import java.io.File;
import java.io.FileDescriptor;
import java.io.IOException;

/** Same-filesystem atomic rename, including replacement, on all supported Android versions. */
final class NotebookShareDisk implements NotebookShareStore.Disk {
    @Override
    public void rename(File source, File destination) throws IOException {
        try {
            Os.rename(source.getPath(), destination.getPath());
        } catch (ErrnoException failure) {
            throw new IOException("Could not commit share queue data", failure);
        }
    }

    @Override
    public void sync(File directory) throws IOException {
        try {
            FileDescriptor descriptor = Os.open(directory.getPath(), OsConstants.O_RDONLY, 0);
            try {
                Os.fsync(descriptor);
            } finally {
                Os.close(descriptor);
            }
        } catch (ErrnoException failure) {
            throw new IOException("Could not sync share queue directory", failure);
        }
    }
}
