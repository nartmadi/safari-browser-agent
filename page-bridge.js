(function () {
  "use strict";

  if (globalThis.__webmcpAgentPageBridgeInstalled) return;
  globalThis.__webmcpAgentPageBridgeInstalled = true;

  const channel = "__webmcp_agent__";
  let session = null;
  let tools = [];
  let context = null;

  const post = (message) => {
    window.postMessage({ channel, ...message }, "*");
  };

  const serializeTool = (tool, index) => ({
    index,
    name: tool.name,
    title: tool.title ?? tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    annotations: tool.annotations ?? {},
    origin: tool.origin ?? location.origin
  });

  const findContext = () => {
    const candidate = document.modelContext ?? globalThis.navigator?.modelContext;
    return typeof candidate?.getTools === "function" && typeof candidate?.executeTool === "function"
      ? candidate
      : null;
  };

  async function discover(requestId, requestSession) {
    context = findContext();
    if (!context) {
      post({ type: "response", session: requestSession, requestId, ok: false, error: "No WebMCP polyfill detected." });
      return;
    }
    try {
      tools = await context.getTools();
      post({ type: "response", session: requestSession, requestId, ok: true, tools: tools.map(serializeTool) });
    } catch (error) {
      post({ type: "response", session: requestSession, requestId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function execute(requestId, requestSession, index, input) {
    context = context ?? findContext();
    const tool = tools[index];
    if (!context || !tool) {
      post({ type: "response", session: requestSession, requestId, ok: false, error: "The requested WebMCP tool is no longer available." });
      return;
    }
    try {
      const result = await context.executeTool(tool, input ?? {});
      post({ type: "response", session: requestSession, requestId, ok: true, result });
    } catch (error) {
      post({ type: "response", session: requestSession, requestId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.channel !== channel) return;
    const message = event.data;
    if (message.type === "hello") {
      post({ type: "ready" });
      return;
    }
    if (message.type === "init") {
      session = message.session;
      return;
    }
    if (message.session !== session) return;
    if (message.type === "discover") void discover(message.requestId, message.session);
    if (message.type === "execute") void execute(message.requestId, message.session, message.index, message.input);
  });
})();
