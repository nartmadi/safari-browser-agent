(() => {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const $ = id => document.getElementById(id);
  const form = document.querySelector("form");
  const provider = $("provider"), key = $("key"), endpoint = $("endpoint"), region = $("region");
  const model = $("model"), modelId = $("model-id"), save = $("save"), status = $("status");
  let hasKey = false, revision = 0, loadingProfile = false, busy = false, debounce;
  const bedrock = () => provider.value === "bedrock";
  const usingSavedKey = () => hasKey && $("key-field").hidden;
  const fields = () => ({
    provider: provider.value, key: usingSavedKey() ? null : key.value.trim(),
    endpoint: endpoint.value.trim(), region: region.value.trim(),
    model: bedrock() ? modelId.value.trim() : model.value
  });
  async function request(type, data = {}) {
    const reply = await api.runtime.sendMessage({ type, ...data });
    if (!reply?.ok) throw new Error(reply?.error || "The extension did not respond.");
    return reply.value;
  }
  function ready() {
    return !busy && !loadingProfile && provider.value && endpoint.validity.valid &&
      (provider.value === "ollama" || usingSavedKey() || key.value.trim());
  }
  function update() {
    save.disabled = !(ready() && fields().model && (!bedrock() || region.value.trim()));
  }
  function list(preferred = "", delay = 0) {
    const version = ++revision;
    clearTimeout(debounce);
    model.replaceChildren(new Option("Select a model", ""));
    model.parentElement.hidden = true;
    status.textContent = "";
    update();
    if (bedrock() || !ready()) return;
    debounce = setTimeout(async () => {
      try {
        const names = await request("modelList", fields());
        if (version !== revision) return;
        model.append(...names.map(name => new Option(name, name)));
        model.value = names.includes(preferred) ? preferred : "";
        model.parentElement.hidden = !names.length;
        update();
      } catch (error) { if (version === revision) status.textContent = error.message; }
    }, delay);
  }
  async function show() {
    const version = ++revision;
    loadingProfile = true;
    hasKey = false;
    key.value = endpoint.value = region.value = modelId.value = "";
    $("credentials").hidden = endpoint.parentElement.hidden = region.parentElement.hidden =
      modelId.parentElement.hidden = model.parentElement.hidden = true;
    status.textContent = "";
    update();
    if (!provider.value) return;
    try {
      const profile = await request("modelProfile", { provider: provider.value });
      if (version !== revision) return;
      hasKey = profile.hasKey;
      $("credentials").hidden = provider.value === "ollama";
      $("stored").hidden = !hasKey;
      $("key-field").hidden = hasKey;
      endpoint.parentElement.hidden = provider.value !== "ollama";
      region.parentElement.hidden = modelId.parentElement.hidden = !bedrock();
      endpoint.value = profile.endpoint;
      region.value = profile.region;
      modelId.value = bedrock() ? profile.model : "";
      loadingProfile = false;
      list(profile.model);
    } catch (error) { if (version === revision) status.textContent = error.message; }
  }
  provider.onchange = show;
  for (const input of [key, endpoint]) input.oninput = () => list("", 400);
  for (const input of [region, modelId, model]) input.oninput = update;
  $("replace").onclick = () => {
    $("stored").hidden = true;
    $("key-field").hidden = false;
    key.focus();
    list();
  };
  $("remove").onclick = async () => {
    provider.disabled = $("remove").disabled = $("replace").disabled = busy = true;
    update();
    try {
      await request("modelRemoveKey", { provider: provider.value });
      await show();
    } catch (error) { status.textContent = error.message; }
    finally { provider.disabled = $("remove").disabled = $("replace").disabled = busy = false; update(); }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (save.disabled) return;
    busy = true;
    update();
    try {
      await request("modelSave", fields());
      key.value = "";
      const current = await api.tabs.getCurrent();
      const original = Number(location.hash.slice(1));
      if (original > 0) await api.tabs.update(original, { active: true }).catch(() => {});
      await api.tabs.remove(current.id);
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; update(); }
  };
  provider.disabled = true;
  request("modelInit").then(id => { provider.value = id; return show(); })
    .catch(error => { status.textContent = error.message; })
    .finally(() => { provider.disabled = false; });
})();
