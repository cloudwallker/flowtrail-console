package dev.flowtrail;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class H2InterruptionTest {
  @TempDir Path directory;

  @Test
  void interruptedWriterMustNotCloseOtherConnections() throws Exception {
    Properties settings = new Properties();
    try (var resource = getClass().getResourceAsStream("/application.properties")) {
      settings.load(resource);
    }
    String configured = settings.getProperty("spring.datasource.url");
    String url =
        configured
            .substring("${FLOWTRAIL_DB_URL:".length(), configured.length() - 1)
            .replace(
                "./data/flowtrail-runtime-v2",
                directory.resolve("interruption").toString().replace('\\', '/'));
    AtomicBoolean attemptedWrite = new AtomicBoolean();
    try (var observer = DriverManager.getConnection(url, "sa", "")) {
      observer.createStatement().execute("CREATE TABLE interruption_probe (id INT PRIMARY KEY)");
      Thread writer =
          new Thread(
              () -> {
                try (var connection = DriverManager.getConnection(url, "sa", "")) {
                  attemptedWrite.set(true);
                  Thread.currentThread().interrupt();
                  connection.createStatement().execute("INSERT INTO interruption_probe VALUES (1)");
                } catch (SQLException permittedInterruptedWriteFailure) {
                  // An interrupted operation may fail; unrelated connections must remain usable.
                } finally {
                  Thread.interrupted();
                }
              });
      writer.start();
      writer.join(10000);
      assertFalse(writer.isAlive(), "interrupted database write must finish");
      assertTrue(attemptedWrite.get(), "writer must reach the interrupted INSERT");
      observer.createStatement().execute("INSERT INTO interruption_probe VALUES (2)");
      try (var rows =
          observer
              .createStatement()
              .executeQuery("SELECT COUNT(*) FROM interruption_probe WHERE id=2")) {
        rows.next();
        assertEquals(1, rows.getInt(1));
      }
    }
  }
}
