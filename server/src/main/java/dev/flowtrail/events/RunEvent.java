package dev.flowtrail.events;

import java.time.Instant;
import java.util.Map;

public record RunEvent(
    String runId,
    String nodeId,
    Integer attemptId,
    long seq,
    String type,
    Map<String, Object> payload,
    Instant createdAt) {
  public RunEvent(
      String runId,
      String nodeId,
      Integer attemptId,
      long seq,
      String type,
      Map<String, Object> payload) {
    this(runId, nodeId, attemptId, seq, type, payload, null);
  }
}
