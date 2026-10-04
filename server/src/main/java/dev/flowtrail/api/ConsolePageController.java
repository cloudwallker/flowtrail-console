package dev.flowtrail.api;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class ConsolePageController {
  @GetMapping({
    "/",
    "/workflows",
    "/workflows/{id}/runs",
    "/workflows/{id}/new",
    "/runs/{id}",
    "/performance"
  })
  public String console() {
    return "forward:/index.html";
  }
}
