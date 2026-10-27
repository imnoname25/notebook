package ru.metroom.notebook;

import org.junit.Test;
import static org.junit.Assert.*;

public class NotebookLaunchPolicyTest {
    private static final String LOCAL = "https://localhost";

    @Test
    public void bundledChooserMayLaunchValidatedHttpOrHttpsNotebook() {
        assertTrue(NotebookLaunchPolicy.allows(LOCAL + "/index.html", LOCAL, "https://notes.example.test/app?client=android"));
        assertTrue(NotebookLaunchPolicy.allows(LOCAL + "/?changeServer=1", LOCAL, "http://192.0.2.1:8080/app"));
        assertTrue(NotebookLaunchPolicy.allows(LOCAL + ":443/", LOCAL, "https://notes.example.test/notebook/app"));
    }

    @Test
    public void remotePagesAndDifferentLocalOriginsCannotRequestNativeLaunch() {
        for (String caller : new String[]{"https://notes.example.test/app", "http://localhost/", "https://localhost:8443/", "https://localhost.example.test/", "https://user@localhost/", "invalid", null}) {
            assertFalse(NotebookLaunchPolicy.allows(caller, LOCAL, "https://notes.example.test/app"));
        }
    }

    @Test
    public void rejectsNonWebTargetsCredentialsFragmentsAndNonAppPaths() {
        for (String target : new String[]{"javascript:alert(1)", "file:///app", "intent://app", "https://user:pass@example.test/app", "https://notes.example.test/app#fragment", "https://notes.example.test/login", "https:///app", "not a URL", null}) {
            assertFalse(NotebookLaunchPolicy.allows(LOCAL, LOCAL, target));
        }
    }
}
