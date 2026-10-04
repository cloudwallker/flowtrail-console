package dev.flowtrail.api;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record Run(
    String id,
    String workflowId,
    RunStatus status,
    Map<String, String> inputs,
    List<NodeResult> nodes,
    Instant startedAt,
    Instant finishedAt,
    long lastEventSeq) {
  public Run(
      String id,
      String workflowId,
      RunStatus status,
      Map<String, String> inputs,
      List<NodeResult> nodes,
      Instant startedAt,
      Instant finishedAt) {
    this(id, workflowId, status, inputs, nodes, startedAt, finishedAt, 0);
  }
}
