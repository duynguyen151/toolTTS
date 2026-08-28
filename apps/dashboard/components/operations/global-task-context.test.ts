import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GlobalTaskProvider, useGlobalTasks } from "./global-task-context";

function TestConsumer() {
  const { runningCount, hasRunningTasks } = useGlobalTasks();
  return createElement("div", { "data-running": runningCount, "data-has-running": hasRunningTasks }, "Consumer");
}

describe("GlobalTaskContext", () => {
  it("provides running count and state to consumer components", () => {
    const html = renderToStaticMarkup(
      createElement(
        GlobalTaskProvider,
        null,
        createElement(TestConsumer),
      ),
    );

    expect(html).toContain('data-running="0"');
    expect(html).toContain('data-has-running="false"');
    expect(html).toContain("Consumer");
  });
});
