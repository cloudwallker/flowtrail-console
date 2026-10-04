package dev.flowtrail;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.flowtrail.api.*;
import dev.flowtrail.events.RunEvent;
import dev.flowtrail.persistence.FlowTrailRepository;
import dev.flowtrail.persistence.RuntimeStore;
import dev.flowtrail.runtime.Lease;
import dev.flowtrail.service.FlowTrailService;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

class MonitorContractTest {
  private static final ObjectMapper MAPPER = new ObjectMapper().findAndRegisterModules();

  @Test
  void exposesCommittedWatermark() {
    DataSource dataSource = CheckpointLeaseTest.h2();
    RuntimeStore store = store(dataSource);
    Run queued = CheckpointLeaseTest.create(dataSource, store);
    assertWatermark(queued, 1);
    Lease lease = store.claim(queued.id(), "monitor-owner", 30).orElseThrow();
    int attempt = store.begin(lease, "first", "input-hash");
    store.complete(lease, "first", attempt, NodeStatus.SUCCEEDED, "saved", null, 12, 0);
    assertWatermark(store.find(queued.id()).orElseThrow(), 4);
    assertThat(store.events(queued.id(), 0, 1000)).hasSize(4);
  }

  @Test
  void usesPersistedEventCreationTime() {
    DataSource dataSource = CheckpointLeaseTest.h2();
    RuntimeStore store = store(dataSource);
    Run queued = CheckpointLeaseTest.create(dataSource, store);
    Instant persistedTime = Instant.parse("2026-10-04T01:02:03.123456Z");
    new JdbcTemplate(dataSource)
        .update(
            "UPDATE run_event SET created_at=? WHERE run_id=? AND seq=1",
            Timestamp.from(persistedTime),
            queued.id());
    List<RunEvent> tail = store.events(queued.id(), 0, 1000);
    assertThat(tail).hasSize(1);
    JsonNode event = MAPPER.valueToTree(tail.getFirst());
    assertThat(event.path("seq").asLong()).isEqualTo(1);
    assertThat(event.hasNonNull("createdAt")).isTrue();
    assertThat(MAPPER.convertValue(event.get("createdAt"), Instant.class)).isEqualTo(persistedTime);
  }

  @ParameterizedTest
  @ValueSource(strings = {"find", "list", "snapshot"})
  void readKeepsNodeAndAttemptAtItsWatermarkDuringConcurrentCompletion(String readPath)
      throws Exception {
    verifyConcurrentRead(CheckpointLeaseTest.h2(), readPath, false);
  }

  @ParameterizedTest
  @ValueSource(strings = {"find", "list", "snapshot"})
  void readKeepsFailedStateAndWatermarkTogetherDuringConcurrentResume(String readPath)
      throws Exception {
    verifyConcurrentRead(CheckpointLeaseTest.h2(), readPath, true);
  }

  @Test
  void nestedResumeReadDoesNotCommitOrReplaceTheOuterWriteTransaction() {
    DataSource dataSource = CheckpointLeaseTest.h2();
    RuntimeStore store = store(dataSource);
    Run run = CheckpointLeaseTest.create(dataSource, store);
    Lease lease = store.claim(run.id(), "rollback-owner", 30).orElseThrow();
    int attempt = store.begin(lease, "first", "input-hash");
    store.complete(lease, "first", attempt, NodeStatus.FAILED, null, "failed", 12, 0);
    assertThat(store.settle(lease)).isTrue();

    TransactionTemplate outer =
        new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    assertThatThrownBy(
            () ->
                outer.executeWithoutResult(
                    status -> {
                      Run resumed = store.resume(run.id());
                      assertThat(resumed.status()).isEqualTo(RunStatus.QUEUED);
                      assertWatermark(resumed, 7);
                      throw new IllegalStateException("rollback fixture");
                    }))
        .isInstanceOf(IllegalStateException.class);

    Run rolledBack = store.find(run.id()).orElseThrow();
    assertThat(rolledBack.status()).isEqualTo(RunStatus.FAILED);
    assertThat(rolledBack.nodes().getFirst().status()).isEqualTo(NodeStatus.FAILED);
    assertWatermark(rolledBack, 6);
    assertThat(store.events(run.id(), 6, 1000)).isEmpty();
  }

  static void verifyConcurrentRead(DataSource dataSource, String readPath, boolean resume)
      throws Exception {
    RuntimeStore writer = store(dataSource);
    Run run = CheckpointLeaseTest.create(dataSource, writer);
    Lease lease = writer.claim(run.id(), "race-owner", 30).orElseThrow();
    int attempt = writer.begin(lease, "first", "input-hash");
    if (resume) {
      writer.complete(lease, "first", attempt, NodeStatus.FAILED, null, "failed", 12, 0);
      assertThat(writer.settle(lease)).isTrue();
    }

    CountDownLatch rootRead = new CountDownLatch(1);
    CountDownLatch writeStarted = new CountDownLatch(1);
    CountDownLatch readMayContinue = new CountDownLatch(1);
    JdbcTemplate readerJdbc =
        new JdbcTemplate(dataSource) {
          private final AtomicBoolean intercept = new AtomicBoolean(true);

          @Override
          public <T> List<T> query(String sql, RowMapper<T> mapper, Object... args) {
            if (sql.startsWith("SELECT * FROM node_run") && intercept.compareAndSet(true, false)) {
              rootRead.countDown();
              await(readMayContinue);
            }
            return super.query(sql, mapper, args);
          }
        };
    RuntimeStore reader = new RuntimeStore(readerJdbc, MAPPER);

    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
      Future<Run> read = executor.submit(() -> read(reader, readPath, run));
      assertThat(rootRead.await(5, TimeUnit.SECONDS)).isTrue();
      Future<?> write =
          executor.submit(
              () -> {
                writeStarted.countDown();
                if (resume) writer.resume(run.id());
                else
                  writer.complete(
                      lease, "first", attempt, NodeStatus.SUCCEEDED, "saved", null, 12, 0);
              });
      assertThat(writeStarted.await(5, TimeUnit.SECONDS)).isTrue();
      try {
        // A stable locking read holds the writer until all nested queries finish.
        // Without that transaction the writer commits between root and child reads.
        write.get(500, TimeUnit.MILLISECONDS);
      } catch (TimeoutException expectedWhileReaderHoldsLock) {
      } finally {
        readMayContinue.countDown();
      }
      Run beforeWrite = read.get(5, TimeUnit.SECONDS);
      write.get(5, TimeUnit.SECONDS);

      NodeResult first = beforeWrite.nodes().getFirst();
      assertThat(beforeWrite.status()).isEqualTo(resume ? RunStatus.FAILED : RunStatus.RUNNING);
      assertThat(first.status()).isEqualTo(resume ? NodeStatus.FAILED : NodeStatus.RUNNING);
      assertThat(first.attempts().getFirst().status()).isEqualTo(resume ? "FAILED" : "RUNNING");
      assertWatermark(beforeWrite, resume ? 6 : 3);

      Run afterWrite = writer.find(run.id()).orElseThrow();
      assertThat(afterWrite.status()).isEqualTo(resume ? RunStatus.QUEUED : RunStatus.RUNNING);
      assertThat(afterWrite.nodes().getFirst().status())
          .isEqualTo(resume ? NodeStatus.PENDING : NodeStatus.SUCCEEDED);
      assertWatermark(afterWrite, resume ? 7 : 4);
    } finally {
      readMayContinue.countDown();
    }
  }

  static void verifyCurrentReadAfterEarlierSnapshot(DataSource dataSource, String readPath)
      throws Exception {
    RuntimeStore store = store(dataSource);
    Run fixture = CheckpointLeaseTest.create(dataSource, store);
    Workflow workflow =
        new FlowTrailRepository(new JdbcTemplate(dataSource), MAPPER)
            .findWorkflow(fixture.workflowId())
            .orElseThrow();
    Run run =
        store.create(
            workflow, workflow.nodes(), java.util.Map.of(), "monitor-key", java.util.Map.of());
    Lease lease = store.claim(run.id(), "read-view-owner", 30).orElseThrow();
    int attempt = store.begin(lease, "first", "input-hash");
    JdbcTemplate jdbc = new JdbcTemplate(dataSource);
    TransactionTemplate outer =
        new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    outer.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);

    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
      outer.executeWithoutResult(
          status -> {
            assertThat(
                    jdbc.queryForObject(
                        "SELECT status FROM node_run WHERE run_id=? AND node_id='first'",
                        String.class,
                        run.id()))
                .isEqualTo("RUNNING");
            Future<?> completed =
                executor.submit(
                    () ->
                        store.complete(
                            lease, "first", attempt, NodeStatus.SUCCEEDED, "saved", null, 12, 0));
            try {
              completed.get(5, TimeUnit.SECONDS);
            } catch (Exception ex) {
              throw new IllegalStateException("Concurrent completion fixture failed", ex);
            }

            Run latest =
                readPath.equals("idempotent-create")
                    ? store.create(
                        workflow,
                        workflow.nodes(),
                        java.util.Map.of(),
                        "monitor-key",
                        java.util.Map.of())
                    : read(store, readPath, run);
            assertThat(latest.id()).isEqualTo(run.id());
            assertWatermark(latest, 4);
            NodeResult node = latest.nodes().getFirst();
            assertThat(node.status()).isEqualTo(NodeStatus.SUCCEEDED);
            assertThat(node.output()).isEqualTo("saved");
            assertThat(node.attempts().getFirst().status()).isEqualTo("SUCCEEDED");
            assertThat(node.attempts().getFirst().finishedAt()).isNotNull();
          });
    }
  }

  private static Run read(RuntimeStore store, String path, Run run) {
    return switch (path) {
      case "find" -> store.find(run.id()).orElseThrow();
      case "list" ->
          store.list(run.workflowId()).stream()
              .filter(candidate -> candidate.id().equals(run.id()))
              .findFirst()
              .orElseThrow();
      case "snapshot" -> store.snapshot(run.id()).run();
      default -> throw new IllegalArgumentException("Unknown read fixture");
    };
  }

  private static RuntimeStore store(DataSource dataSource) {
    return new RuntimeStore(new JdbcTemplate(dataSource), MAPPER);
  }

  private static void assertWatermark(Run run, long expected) {
    JsonNode json = MAPPER.valueToTree(run);
    assertThat(json.has("lastEventSeq")).isTrue();
    assertThat(json.path("lastEventSeq").asLong()).isEqualTo(expected);
  }

  private static void await(CountDownLatch latch) {
    try {
      if (!latch.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Fixture timed out");
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(ex);
    }
  }
}

@EnabledIfEnvironmentVariable(named = "FLOWTRAIL_TEST_MYSQL_URL", matches = "jdbc:mysql:.*")
class MySqlMonitorContractTest {
  private DataSource mysql() {
    DataSource dataSource =
        new DriverManagerDataSource(
            System.getenv("FLOWTRAIL_TEST_MYSQL_URL"),
            System.getenv().getOrDefault("FLOWTRAIL_TEST_MYSQL_USER", "root"),
            System.getenv().getOrDefault("FLOWTRAIL_TEST_MYSQL_PASSWORD", ""));
    org.flywaydb.core.Flyway.configure().dataSource(dataSource).load().migrate();
    return dataSource;
  }

  @Test
  void mysqlReadPathsKeepTheirWatermarkDuringCompletionAndResume() throws Exception {
    DataSource dataSource = mysql();
    for (String path : List.of("find", "list", "snapshot")) {
      MonitorContractTest.verifyConcurrentRead(dataSource, path, false);
      MonitorContractTest.verifyConcurrentRead(dataSource, path, true);
    }
  }

  @Test
  void mysqlReadPathsUseCurrentChildrenAfterAnEarlierRepeatableReadSnapshot() throws Exception {
    DataSource dataSource = mysql();
    for (String path : List.of("find", "list", "snapshot")) {
      MonitorContractTest.verifyCurrentReadAfterEarlierSnapshot(dataSource, path);
    }
  }

  @Test
  void mysqlIdempotentCreateUsesCurrentChildrenAfterAnEarlierRepeatableReadSnapshot()
      throws Exception {
    MonitorContractTest.verifyCurrentReadAfterEarlierSnapshot(mysql(), "idempotent-create");
  }
}

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "spring.datasource.url=jdbc:h2:mem:monitor-handshake;DB_CLOSE_DELAY=-1",
      "flowtrail.runtime.enabled=false"
    })
class MonitorSseHandshakeTest {
  @Autowired FlowTrailService service;
  @Autowired RuntimeStore store;
  @LocalServerPort int port;

  @Test
  void idleCaughtUpStreamImmediatelyCommitsHeadersWithoutAdvancingItsEventCursor()
      throws Exception {
    NodeDefinition node =
        new NodeDefinition(
            "idle", NodeType.TEXT, List.of(), "saved", null, null, java.util.Map.of(), null, null);
    Workflow workflow = service.createWorkflow(new WorkflowRequest("idle", List.of(node)));
    Run run = service.executeWorkflow(workflow.id(), new RunRequest(java.util.Map.of()), null);
    HttpRequest request =
        HttpRequest.newBuilder(
                URI.create(
                    "http://127.0.0.1:"
                        + port
                        + "/api/runs/"
                        + run.id()
                        + "/events?after="
                        + run.lastEventSeq()))
            .GET()
            .build();
    try (HttpClient client = HttpClient.newHttpClient()) {
      CompletableFuture<HttpResponse<InputStream>> response =
          client.sendAsync(request, HttpResponse.BodyHandlers.ofInputStream());
      try {
        HttpResponse<InputStream> opened;
        try {
          opened = response.get(3, TimeUnit.SECONDS);
        } catch (TimeoutException ex) {
          throw new AssertionError("Idle SSE did not commit response headers within 3 seconds", ex);
        }
        assertThat(opened.statusCode()).isEqualTo(200);
        assertThat(opened.headers().firstValue("Content-Type").orElseThrow())
            .startsWith("text/event-stream");
        try (BufferedReader body =
            new BufferedReader(new InputStreamReader(opened.body(), StandardCharsets.UTF_8))) {
          assertThat(body.readLine()).isEqualTo(":connected");
          assertThat(body.readLine()).isEmpty();
        }
        assertThat(store.find(run.id()).orElseThrow().lastEventSeq()).isEqualTo(run.lastEventSeq());
        assertThat(store.events(run.id(), run.lastEventSeq(), 1000)).isEmpty();
      } finally {
        response.cancel(true);
      }
    }
  }
}
