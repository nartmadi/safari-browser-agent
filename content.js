(function () {
  "use strict";

  if (globalThis.__webmcpAgentRelayInstalled) return;
  globalThis.__webmcpAgentRelayInstalled = true;

  const browserApi = globalThis.browser ?? globalThis.chrome;
  const channel = "__webmcp_agent__";
  const session = crypto.randomUUID();
  const pending = new Map();
  const pendingAgent = new Map();
  let bridgeReady = false;
  let panelHost = null;
  let refreshPanelModel = null;
  let layoutStyle = null;
  let tools = [];
  let confirmationHandler = null;
  let streamHandler = null;
  let activeChatRequest = null;
  let toolCallHandler = null;
  const conversationHistory = [];

  const requestPage = (message) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const deadline = Date.now() + 10000;
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("The WebMCP page bridge timed out."));
    }, 10000);
    pending.set(requestId, { resolve, reject, timer });
    const send = () => {
      if (!pending.has(requestId) || Date.now() >= deadline) return;
      if (!bridgeReady) {
        window.setTimeout(send, 25);
        return;
      }
      window.postMessage({ channel, session, requestId, ...message }, "*");
    };
    send();
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.channel !== channel) return;
    if (message.type === "ready") {
      bridgeReady = true;
      window.postMessage({ channel, type: "init", session }, "*");
      return;
    }
    if (message.session !== session || message.type !== "response") return;
    const entry = pending.get(message.requestId);
    if (!entry) return;
    pending.delete(message.requestId);
    window.clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message);
    else entry.reject(new Error(message.error || "The page rejected the request."));
  });

  const hello = () => {
    if (!bridgeReady) window.postMessage({ channel, type: "hello" }, "*");
  };
  hello();
  const helloTimer = window.setInterval(hello, 250);
  window.setTimeout(() => window.clearInterval(helloTimer), 15000);

  function sendAgent(message) {
    const requestId = crypto.randomUUID();
    if (message.type === "agentAsk" || message.type === "agentDecision") activeChatRequest = requestId;
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (error, value) => {
        if (settled) return;
        settled = true;
        pendingAgent.delete(requestId);
        if (activeChatRequest === requestId) activeChatRequest = null;
        error ? reject(error) : resolve(value);
      };
      const timer = window.setTimeout(() => {
        settle(new Error("The agent did not return a result."));
      }, 120000);
      const finish = (error, value) => {
        window.clearTimeout(timer);
        settle(error, value);
      };
      pendingAgent.set(requestId, { settle: finish });
      void browserApi.runtime.sendMessage({ ...message, requestId }).then((response) => {
        if (!response) return;
        if (response.ok) finish(null, response.value);
        else finish(new Error(response.error || "The agent request failed."));
      }).catch(() => {
        // Safari may close the direct response channel; storage remains the fallback.
      });
      const poll = async () => {
        if (settled) return;
        try {
          const stored = await browserApi.runtime.sendMessage({ type: "agentReadResult", requestId });
          if (stored) {
            stored.ok ? finish(null, stored.value) : finish(new Error(stored.error || "The agent request failed."));
            return;
          }
        } catch { /* Direct delivery can still succeed. */ }
        if (!settled) window.setTimeout(poll, 1000);
      };
      window.setTimeout(poll, 1000);
    });
  }

  function panelMarkup() {
    return `
      <main>
        <header class="hero"><div class="hero-row"><button id="page-back" class="back" type="button" aria-label="Back to chat" hidden>←</button><div class="brand"><h1 id="header-title">WebMCP Agent<span id="attribution"> by <a style="color:#fff;text-decoration:none" href="https://x.com/nartmadi" target="_blank" rel="noreferrer">@nartmadi</a></span></h1></div><div class="actions"><button class="model-button" aria-label="Open model" title="Model"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1"></rect><path d="M9 3v4M12 3v4M15 3v4M9 17v4M12 17v4M15 17v4M3 9h4M3 12h4M3 15h4M17 9h4M17 12h4M17 15h4"></path></svg></button><button class="close" aria-label="Close agent"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></div></div></header>
        <section class="conversation"><div id="transcript" class="transcript"><div id="discovery-state" class="discovery-state" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>Checking WebMCP polyfill</span></div></div><form id="form"><div class="composer-row"><textarea id="prompt" aria-label="Message" rows="3" maxlength="2000" placeholder="No WebMCP polyfill detected." required disabled></textarea><button id="send" type="submit" aria-label="Send" hidden disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"></path></svg></button></div></form></section>
        <section id="tools-view" hidden><div class="page-content"><ul id="tools"></ul></div></section>
      </main>`;
  }

  function panelStyles() {
    return `
      .message, .message-body { min-inline-size:0; }
      .response-table { overflow-x:auto; max-inline-size:100%; margin-block-end:10px; }
      .response-table table { border-collapse:collapse; width:100%; }
      .response-table :is(th,td) { padding:5px 8px; text-align:start; white-space:nowrap; border-bottom:1px solid #333; }
      :host { all:initial; display:block; width:100%; height:100%; overflow:hidden; overscroll-behavior:none; background:#111; color:#f5f5f5; }
      * { box-sizing:border-box; }
      main { display:flex; flex-direction:column; height:100%; min-height:100%; overflow:hidden; overscroll-behavior:none; padding:22px 20px 16px; background:#111; color:#f5f5f5; font:14px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif; }
      h1,h2,p { margin:0; } h1 { font-size:19px; line-height:28px; font-weight:600; letter-spacing:-.01em; } h2 { font-size:16px; font-weight:600; }
      .hero { display:flex; flex:0 0 auto; justify-content:center; min-height:45px; margin:-22px -20px 0; padding:22px 20px 16px; background:#171717; border-bottom:1px solid #2b2b2b; } .hero-row { display:grid; width:100%; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); grid-template-areas:"back brand actions"; align-items:center; } .hero-row.chat-view { grid-template-columns:minmax(0,1fr) auto; grid-template-areas:"brand actions"; } .hero-row > .back { grid-area:back; align-self:center; justify-self:start; } .hero-row > .back[hidden] { display:none !important; } .brand { grid-area:brand; display:grid; justify-items:center; } .chat-view .brand { justify-items:start; } h1 .attribution { color:inherit; font-size:inherit; line-height:inherit; text-decoration:none; } h1 .attribution a, h1 .attribution a:visited { color:#fff !important; -webkit-text-fill-color:#fff !important; text-decoration:none; } h1 .attribution a:hover { color:#fff !important; -webkit-text-fill-color:#fff !important; text-decoration:underline; } .actions { grid-area:actions; display:flex; align-items:center; align-self:center; justify-self:end; gap:2px; } .actions > button svg { display:block; width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.7; }
      button { border:0; background:transparent; color:#f5f5f5; cursor:pointer; font:inherit; } button:focus, select:focus, input:focus, textarea:focus { outline:none; } .back { display:inline-grid; place-items:center; min-width:28px; min-height:28px; padding:2px 4px; font-size:20px; line-height:1; }
      .actions > button { appearance:none; display:grid; place-items:center; flex:none; width:28px; height:28px; margin:0; padding:0; }
      button:disabled { opacity:.4; }
      .conversation { display:flex; flex:1 1 auto; min-height:0; flex-direction:column; }
      textarea { display:block; width:100%; margin:0; border:1px solid #555; border-radius:4px; background:#181818; color:#f5f5f5; font:inherit; font-size:16px; resize:none; min-height:76px; padding:10px; } #prompt:focus::placeholder { color:transparent; }
      .status,.muted { margin:8px 0 20px; color:#999; font-size:12px; } ul { display:grid; gap:4px; margin:0; padding:0; list-style:none; } li { padding:5px 0; border-bottom:1px solid #333; } code { color:#f5f5f5; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; letter-spacing:-.01em; }
      .transcript { scrollbar-gutter:stable; }
      .message { white-space:pre-wrap; }
      .transcript { display:grid; flex:1; min-height:100px; align-content:start; gap:18px; margin:18px 0; overflow:auto; scrollbar-width:none; -ms-overflow-style:none; overscroll-behavior:contain; } .transcript::-webkit-scrollbar, .page-content::-webkit-scrollbar { display:none; } .discovery-state { display:grid; place-items:center; align-content:center; gap:10px; height:100%; min-height:160px; color:#888; font-size:12px; text-align:center; } .spinner { width:18px; height:18px; border:2px solid #444; border-top-color:#f5f5f5; border-radius:50%; animation:spin .8s linear infinite; } @keyframes spin { to { transform:rotate(360deg); } } .empty { margin:auto 0; color:#777; } .message { display:grid; gap:3px; margin:0; padding:0 0 14px; border-bottom:1px solid #2b2b2b; overflow-wrap:anywhere; } .message:last-child { border-bottom:0; } .message-role { color:#888; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; } .message-body { color:#f5f5f5; } .message-body p { margin:0 0 10px; white-space:pre-wrap; } .message-body p:last-child { margin-bottom:0; } .message-body ul { display:grid; gap:4px; margin:0 0 10px; padding-left:18px; list-style:disc; } .message-body li { padding:0; border:0; white-space:pre-wrap; } .message-body code { padding:1px 4px; border-radius:3px; background:#252525; } .tool-call { color:#55d6e8; font-style:italic; } .thinking .message-body { background:linear-gradient(90deg,#777 20%,#fff 45%,#777 70%); background-size:200% auto; background-clip:text; -webkit-background-clip:text; color:transparent; animation:shimmer 1.2s linear infinite; } @keyframes shimmer { to { background-position:200% center; } } .tool .message-body { color:#aaa; font-size:12px; }
      .confirmation { display:grid; gap:8px; padding:12px; border:1px solid #555; border-radius:4px; color:#ddd; font-size:12px; } .confirmation strong { color:#fff; font-size:13px; } .confirmation code { max-height:100px; overflow:auto; padding:8px; background:#181818; color:#aaa; white-space:pre-wrap; overflow-wrap:anywhere; } .confirmation-actions { display:flex; justify-content:flex-end; gap:8px; } .confirmation-actions button { padding:7px 12px; border:1px solid #555; border-radius:4px; } .confirmation-actions button:last-child { border-color:#f5f5f5; background:#f5f5f5; color:#111; }
      .tools-button { min-width:28px; min-height:28px; padding:2px 4px; } .tools-button svg { display:block; width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.7; } .tools-button:hover { color:#bbb; } .tool-item { display:grid; width:100%; gap:6px; padding:8px 0; text-align:left; } .tool-title { display:flex; align-items:center; gap:8px; } .tool-name { color:#f5f5f5; } .tool-badge { padding:2px 6px; border:1px solid #866; border-radius:999px; color:#e6b6b6; font-size:10px; line-height:1.2; white-space:nowrap; } .tool-description { display:-webkit-box; max-height:2.8em; overflow:hidden; color:#888; font-size:12px; line-height:1.4; text-overflow:ellipsis; -webkit-box-orient:vertical; -webkit-line-clamp:2; } .tool-item:hover .tool-description { color:#fff; } .tool-item[aria-expanded="true"] .tool-description { display:block; max-height:none; } .composer-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:stretch; gap:8px; } #send { display:inline-grid; place-items:center; min-width:44px; min-height:76px; padding:0 12px; border:1px solid #f5f5f5; border-radius:4px; background:#f5f5f5; color:#111; font-weight:600; } #send svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:2; } #send:hover { background:#d8d8d8; border-color:#d8d8d8; } #send:disabled { background:#555; border-color:#555; color:#aaa; }
      #tools-view[hidden], .conversation[hidden] { display:none; } #tools-view:not([hidden]) { display:flex; flex:1; min-height:0; flex-direction:column; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:none; -ms-overflow-style:none; padding-top:16px; } .page-content { display:flex; flex-direction:column; gap:16px; } #tools li:last-child { border-bottom:0; } footer { flex:0 0 auto; margin-top:16px; font-size:12px; } footer a { color:#999; }
    `;
  }

  function appendMessage(transcript, kind, text) {
    transcript.querySelector(".empty")?.remove();
    const node = document.createElement("div");
    node.className = `message ${kind}`;
    const role = document.createElement("span");
    role.className = "message-role";
    role.textContent = kind === "user" ? "You" : "Agent";
    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = text;
    node.append(role, body);
    transcript.append(node);
    transcript.scrollTop = transcript.scrollHeight;
    return body;
  }

  function renderInlineMarkdown(parent, text) {
    const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
      const token = match[0];
      const element = document.createElement(token.startsWith("**") ? "strong" : token.startsWith("`") ? "code" : "em");
      element.textContent = token.slice(token.startsWith("**") ? 2 : 1, token.startsWith("**") ? -2 : -1);
      parent.append(element);
      cursor = match.index + token.length;
    }
    if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
  }

  function renderMarkdown(container, text) {
    container.replaceChildren();
    const lines = String(text || "").split(/\r?\n/);
    let paragraph = [];
    let list = null;
    const flushParagraph = () => {
      if (!paragraph.length) return;
      const block = document.createElement("p");
      renderInlineMarkdown(block, paragraph.join("\n"));
      container.append(block);
      paragraph = [];
    };
    const flushList = () => {
      if (!list) return;
      container.append(list);
      list = null;
    };
    const cells = (line) => line.trim().replace(/^\||(?<!\\)\|$/g, "").split(/(?<!\\)\|/).map(s => s.trim().replace(/\\\|/g, "|"));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const divider = lines[i + 1]?.trim();
      if (line.includes("|") && divider && /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/.test(divider)
          && cells(line).length === cells(divider).length) {
        flushParagraph();
        flushList();
        const headers = cells(line);
        const wrapper = document.createElement("div");
        wrapper.className = "response-table";
        wrapper.tabIndex = 0;
        wrapper.setAttribute("role", "region");
        wrapper.setAttribute("aria-label", headers.join(", ") || "Response table");
        const table = document.createElement("table");
        const head = table.createTHead().insertRow();
        for (const label of headers) {
          const th = document.createElement("th");
          th.scope = "col";
          renderInlineMarkdown(th, label);
          head.append(th);
        }
        const body = table.createTBody();
        i++;
        while (lines[i + 1]?.includes("|")) {
          const values = cells(lines[++i]);
          const row = body.insertRow();
          headers.forEach((_, index) => renderInlineMarkdown(row.insertCell(), values[index] ?? ""));
        }
        wrapper.append(table);
        container.append(wrapper);
      } else if (line.startsWith("- ")) {
        flushParagraph();
        list ||= document.createElement("ul");
        const item = document.createElement("li");
        renderInlineMarkdown(item, line.slice(2));
        list.append(item);
      } else if (!line.trim()) {
        flushParagraph();
        flushList();
      } else {
        flushList();
        paragraph.push(line);
      }
    }
    flushParagraph();
    flushList();
  }

  async function initializePanel(root) {
    const prompt = root.querySelector("#prompt");
    const send = root.querySelector("#send");
    let model = "";
    const updateSendState = () => { send.disabled = prompt.disabled || !tools.length || !model || !prompt.value.trim(); };
    const refreshModel = async () => {
      const response = await browserApi.runtime.sendMessage({ type: "activeModel" }).catch(() => null);
      model = response?.value?.model || "";
      updateSendState();
    };
    refreshPanelModel = refreshModel;
    prompt.addEventListener("input", updateSendState);
    void refreshModel();
    try {
      const response = await requestPage({ type: "discover" });
      tools = response.tools ?? [];
      root.querySelector("#discovery-state")?.remove();
      prompt.disabled = tools.length === 0;
      prompt.placeholder = tools.length ? "What should I do?" : "No WebMCP tools detected.";
      updateSendState();
      send.hidden = tools.length === 0;
      if (tools.length) {
        const toolsButton = document.createElement("button");
        toolsButton.id = "tools-button";
        toolsButton.className = "tools-button";
        toolsButton.type = "button";
        toolsButton.setAttribute("aria-label", "Open WebMCP tools");
        toolsButton.title = `WebMCP tools (${tools.length})`;
        toolsButton.setAttribute("aria-controls", "tools-view");
        toolsButton.setAttribute("aria-expanded", "false");
        toolsButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8a5 5 0 0 1-6.5 4.8L7 20.3a2.33 2.33 0 0 1-3.3-3.3l7.5-7.5A5 5 0 0 1 16 3l-3 3 1 4 4 1z" stroke-linejoin="round"></path></svg>';
        toolsButton.addEventListener("click", root.__showTools);
        root.querySelector(".actions").prepend(toolsButton);
      }
      root.querySelector("#tools").replaceChildren(...tools.map((tool) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.className = "tool-item";
        button.type = "button";
        button.setAttribute("aria-expanded", "false");
        const title = document.createElement("span");
        title.className = "tool-title";
        const name = document.createElement("code");
        name.className = "tool-name";
        name.textContent = tool.name;
        title.append(name);
        if (tool.annotations?.consequentialHint === true) {
          const badge = document.createElement("span");
          badge.className = "tool-badge";
          badge.textContent = "Confirmation required";
          title.append(badge);
        }
        const description = document.createElement("span");
        description.className = "tool-description";
        description.textContent = tool.description || "No description available.";
        button.append(title, description);
        button.addEventListener("click", () => {
          const expanded = button.getAttribute("aria-expanded") === "true";
          button.setAttribute("aria-expanded", String(!expanded));
        });
        item.append(button);
        return item;
      }));
    } catch (error) {
      root.querySelector("#discovery-state")?.remove();
      prompt.disabled = true;
      prompt.placeholder = error.message || "No WebMCP polyfill detected.";
      updateSendState();
      send.hidden = true;
      root.querySelector("#tools").replaceChildren();
    }
    confirmationHandler = (message, body) => new Promise((resolve) => {
      const transcript = root.querySelector("#transcript");
      const prompt = root.querySelector("#prompt");
      const send = root.querySelector("#send");
      const node = document.createElement("div");
      node.className = "confirmation";
      const title = document.createElement("strong");
      title.textContent = `Allow ${message.tool.name}?`;
      const description = document.createElement("span");
      description.textContent = message.tool.description || "This tool wants to change the page.";
      const input = document.createElement("code");
      input.textContent = JSON.stringify(message.tool.input ?? {}, null, 2);
      const actions = document.createElement("div");
      actions.className = "confirmation-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      const allow = document.createElement("button");
      allow.type = "button";
      allow.textContent = "Allow";
      actions.append(cancel, allow);
      node.append(title, description, input, actions);
      body.replaceChildren(node);
      transcript.scrollTop = transcript.scrollHeight;
      prompt.disabled = true;
      send.disabled = true;
      const finish = (approved) => {
        cancel.disabled = true;
        allow.disabled = true;
        node.remove();
        resolve(approved);
      };
      cancel.addEventListener("click", () => finish(false), { once: true });
      allow.addEventListener("click", () => finish(true), { once: true });
      allow.focus();
    });
    root.querySelector("#form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const prompt = root.querySelector("#prompt");
      const send = root.querySelector("#send");
      const transcript = root.querySelector("#transcript");
      const text = prompt.value.trim();
      if (!text || !model) return;
      prompt.value = "";
      send.disabled = true;
      prompt.disabled = true;
      appendMessage(transcript, "user", text);
      const body = appendMessage(transcript, "agent", "");
      const turn = body.parentElement;
      const scroll = () => { transcript.scrollTop = transcript.scrollHeight; };
      const showThinking = () => {
        turn.classList.add("thinking");
        body.textContent = "Thinking…";
        scroll();
      };
      showThinking();
      toolCallHandler = (name) => {
        const line = document.createElement("em");
        line.className = "tool-call";
        line.textContent = `Called ${name}`;
        body.before(line);
        showThinking();
      };
      streamHandler = (text) => {
        turn.classList.remove("thinking");
        body.textContent = text;
        scroll();
      };
      try {
        const history = [...conversationHistory, { role: "user", content: text }];
        let answer = await sendAgent({
          type: "agentAsk",
          session,
          prompt: text,
          history
        });
        while (answer?.confirmation) {
          turn.classList.remove("thinking");
          if (!root.isConnected || !confirmationHandler) return;
          const approved = await confirmationHandler(answer, body);
          showThinking();
          answer = await sendAgent({ type: "agentDecision", confirmation: answer.confirmation, approved });
        }
        conversationHistory.push({ role: "user", content: text }, { role: "assistant", content: answer });
        turn.classList.remove("thinking");
        renderMarkdown(body, answer);
        scroll();
      } catch (error) {
        if (turn.classList.contains("thinking")) body.replaceChildren();
        turn.classList.remove("thinking");
        const notice = document.createElement("p");
        notice.setAttribute("role", "alert");
        notice.textContent = error.message;
        body.append(notice);
        scroll();
      } finally {
        streamHandler = null;
        toolCallHandler = null;
        prompt.disabled = tools.length === 0;
        updateSendState();
      }
    });
    root.querySelector("#prompt").addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (event.isComposing || event.keyCode === 229) return;
      root.querySelector("#form").requestSubmit();
    });
  }

  function togglePanel() {
    if (panelHost) {
      refreshPanelModel = null;
      confirmationHandler = null;
      streamHandler = null;
      toolCallHandler = null;
      panelHost.remove();
      panelHost = null;
      layoutStyle?.remove();
      layoutStyle = null;
      document.documentElement.removeAttribute("data-webmcp-agent-open");
      return;
    }
    layoutStyle = document.createElement("style");
    layoutStyle.textContent = "html[data-webmcp-agent-open] body { margin-inline-end:420px !important; } @media(max-width:480px){html[data-webmcp-agent-open] body{margin-inline-end:100vw !important}}";
    (document.head || document.documentElement).append(layoutStyle);
    document.documentElement.setAttribute("data-webmcp-agent-open", "");
    panelHost = document.createElement("div");
    panelHost.style.cssText = [
      "all: initial",
      "position: fixed",
      "top: 0",
      "bottom: 0",
      "right: 0",
      "left: auto",
      "z-index: 2147483647",
      "display: block",
      "inline-size: min(420px, 100vw)",
      "height: auto",
      "min-height: 0",
      "overflow: hidden",
      "overscroll-behavior: none",
      "border-inline-start: 1px solid #333",
      "box-shadow: -8px 0 28px #0008"
    ].join(";");
    const shadow = panelHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = panelStyles();
    shadow.append(style);
    const root = document.createElement("div");
    root.style.cssText = "height:100%; min-height:100%; overflow:hidden; overscroll-behavior:none;";
    root.innerHTML = panelMarkup();
    shadow.append(root);
    const chat = root.querySelector(".conversation");
    const toolsView = root.querySelector("#tools-view");
    const heroRow = root.querySelector(".hero-row");
    const headerTitle = root.querySelector("#header-title");
    const pageBack = root.querySelector("#page-back");
    const attribution = root.querySelector("#attribution");
    const showChat = () => {
      heroRow.classList.add("chat-view");
      toolsView.hidden = true;
      chat.hidden = false;
      pageBack.hidden = true;
      headerTitle.replaceChildren(document.createTextNode("WebMCP Agent"), attribution);
      attribution.hidden = false;
      root.querySelector("#tools-button")?.setAttribute("aria-expanded", "false");
    };
    root.querySelector(".close").addEventListener("click", togglePanel);
    root.querySelector(".model-button").addEventListener("click", () => {
      void browserApi.runtime.sendMessage({ type: "openModel" });
    });
    pageBack.addEventListener("click", showChat);
    const showTools = () => {
      heroRow.classList.remove("chat-view");
      toolsView.hidden = false;
      chat.hidden = true;
      pageBack.hidden = false;
      headerTitle.textContent = `Tools (${tools.length})`;
      attribution.hidden = true;
      root.querySelector("#tools-button")?.setAttribute("aria-expanded", "true");
    };
    root.__showTools = showTools;
    heroRow.classList.add("chat-view");
    document.documentElement.append(panelHost);
    void initializePanel(root);
  }

  async function handlePageMessage(message) {
    try {
      const response = await requestPage({ type: message.operation, index: message.index, input: message.input });
      void browserApi.runtime.sendMessage({
        type: "agentPageResult",
        requestId: message.requestId,
        response,
        ok: true
      }).catch(() => {});
    } catch (error) {
      void browserApi.runtime.sendMessage({
        type: "agentPageResult",
        requestId: message.requestId,
        ok: false,
        error: error.message
      }).catch(() => {});
    }
  }

  browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "agentResult") {
      const request = pendingAgent.get(message.requestId);
      if (request) message.ok
        ? request.settle(null, message.value)
        : request.settle(new Error(message.error || "The agent request failed."));
      sendResponse(true);
      return;
    }
    if (message?.type === "modelChanged") void refreshPanelModel?.();
    if (message?.type === "togglePanel") {
      togglePanel();
      return;
    }
    if (message?.type === "agentPageRequest") void handlePageMessage(message);
    if (message?.type === "agentToolCall" && activeChatRequest === message.requestId) toolCallHandler?.(message.name);
    if (message?.type === "agentStream" && activeChatRequest === message.requestId) streamHandler?.(message.text);
  });
})();
