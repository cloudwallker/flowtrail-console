package dev.flowtrail;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.flowtrail.api.ConsolePageController;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ConsolePageTest {
  private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new ConsolePageController()).build();

  @ParameterizedTest
  @ValueSource(
      strings = {
        "/",
        "/workflows",
        "/workflows/demo/runs",
        "/workflows/demo/new",
        "/runs/demo",
        "/performance"
      })
  void forwardsSupportedConsoleDeepLinks(String path) throws Exception {
    mvc.perform(get(path)).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"/api/health", "/api/runs/missing", "/assets/missing.js"})
  void leavesApiAndAssetsOutsideTheSpaController(String path) throws Exception {
    mvc.perform(get(path)).andExpect(status().isNotFound());
  }
}
