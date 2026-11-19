# WebMCP Agent for Safari

A chat sidebar for Safari that uses tools webpages expose through the [WebMCP polyfill](https://github.com/w3c-oss/webmcp-polyfill).

**Experimental developer preview.** Tool calls can change the current site. If a request times out, check the page before retrying.

https://github.com/user-attachments/assets/79ae1bab-8f8d-437c-b5ba-4bea6520d9c8

## Install

Safari requires unsigned extensions to be enabled.

1. In Safari's **Develop** menu, choose **Add Temporary Extension** and select this folder.
2. Open a WebMCP-enabled page, click **WebMCP Agent** in the toolbar, and grant site access.
3. Click the CPU icon, pick a provider, set a model, and click **Save**.

## Providers

Ollama, OpenAI, Anthropic, Google Gemini, and Amazon Bedrock (Converse API). Credentials are entered on the extension's Model page and kept in extension-local storage. The sidebar never receives them. The selected provider receives your conversation, tool definitions, and tool results.

## Safety

- Consequential tools require **Allow** or **Cancel**.
- Read-only and untrusted-content hints are respected.
- The tools button appears only when the page exposes WebMCP tools.

## License

[AGPL-3.0](LICENSE)
