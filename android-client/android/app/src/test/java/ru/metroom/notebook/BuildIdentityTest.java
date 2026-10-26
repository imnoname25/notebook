package ru.metroom.notebook;

import org.junit.Test;
import static org.junit.Assert.*;

public class BuildIdentityTest {
    @Test
    public void buildIdentifiesItsActualSourceAndKeepsThePackage() {
        assertEquals("ru.metroom.notebook", BuildConfig.APPLICATION_ID);
        assertTrue(BuildConfig.SOURCE_COMMIT.matches("[0-9a-f]{40}"));
        assertTrue(BuildConfig.VERSION_CODE > 0);
        if (BuildConfig.DEBUG) assertTrue(BuildConfig.VERSION_NAME.endsWith("-g" + BuildConfig.SOURCE_COMMIT.substring(0, 8)));
    }
}
