// Preference pane binding script
// Uses Services.prefs (Mozilla prefs service) directly for reliability.

var _llmPrefBranch = Services.prefs.getBranch("extensions.zotero.llm-metadata.");

function _llmGetPref(key, type) {
  try {
    if (type === "bool") return _llmPrefBranch.getBoolPref(key);
    if (type === "int") return _llmPrefBranch.getIntPref(key);
    return _llmPrefBranch.getStringPref(key);
  } catch (e) {
    return undefined;
  }
}

function _llmSetPref(key, value, type) {
  try {
    if (type === "bool") _llmPrefBranch.setBoolPref(key, value);
    else if (type === "int") _llmPrefBranch.setIntPref(key, value);
    else _llmPrefBranch.setStringPref(key, String(value));
    Zotero.debug("[LLM Prefs] Set " + key + " = " + value);
  } catch (e) {
    Zotero.debug("[LLM Prefs] ERROR setting " + key + ": " + e);
  }
}

function _llmSyncInput(elementId, prefKey, type) {
  var el = document.getElementById(elementId);
  if (!el) {
    Zotero.debug("[LLM Prefs] Element not found: " + elementId);
    return false;
  }
  var val = _llmGetPref(prefKey, type || "string");
  if (val !== undefined) {
    el.value = String(val);
  }
  el.addEventListener("change", function () {
    _llmSetPref(prefKey, el.value, type || "string");
  });
  el.addEventListener("input", function () {
    _llmSetPref(prefKey, el.value, type || "string");
  });
  Zotero.debug("[LLM Prefs] Bound input: " + elementId + " (current: " + val + ")");
  return true;
}

function _llmSyncMenulist(elementId, prefKey) {
  var el = document.getElementById(elementId);
  if (!el) {
    Zotero.debug("[LLM Prefs] Element not found: " + elementId);
    return false;
  }
  var val = _llmGetPref(prefKey, "string");
  if (val !== undefined) {
    el.value = String(val);
  }
  el.addEventListener("command", function () {
    _llmSetPref(prefKey, el.value, "string");
  });
  Zotero.debug("[LLM Prefs] Bound menulist: " + elementId + " (current: " + val + ")");
  return true;
}

function _llmSyncCheckbox(elementId, prefKey) {
  var el = document.getElementById(elementId);
  if (!el) {
    Zotero.debug("[LLM Prefs] Element not found: " + elementId);
    return false;
  }
  var val = _llmGetPref(prefKey, "bool");
  if (val !== undefined) {
    el.checked = val;
  }
  el.addEventListener("command", function () {
    _llmSetPref(prefKey, el.checked, "bool");
  });
  Zotero.debug("[LLM Prefs] Bound checkbox: " + elementId + " (current: " + val + ")");
  return true;
}

function _llmInitPrefs() {
  Zotero.debug("[LLM Prefs] Initializing (attempt)...");

  var testEl = document.getElementById("llm-metadata-provider");
  if (!testEl) {
    Zotero.debug("[LLM Prefs] DOM not ready yet, will retry.");
    return false;
  }

  _llmSyncMenulist("llm-metadata-provider", "provider");
  _llmSyncInput("llm-metadata-apiKey", "apiKey");
  _llmSyncInput("llm-metadata-endpoint", "endpoint");
  _llmSyncInput("llm-metadata-model", "model");
  _llmSyncInput("llm-metadata-temperature", "temperature");
  _llmSyncInput("llm-metadata-maxPages", "maxPages", "int");
  _llmSyncCheckbox("llm-metadata-verifyDOI", "verifyDOI");
  _llmSyncCheckbox("llm-metadata-verifyISBN", "verifyISBN");
  _llmSyncCheckbox("llm-metadata-enableOCR", "enableOCR");
  _llmSyncMenulist("llm-metadata-overwriteMode", "overwriteMode");
  _llmSyncCheckbox("llm-metadata-autoExtract", "autoExtract");

  Zotero.debug("[LLM Prefs] Init complete.");
  return true;
}

// Retry loop: pane DOM may not exist yet when this script runs
(function _llmTryInit(attempt) {
  if (_llmInitPrefs()) return;
  if (attempt >= 20) {
    Zotero.debug("[LLM Prefs] Gave up waiting for DOM after 20 attempts.");
    return;
  }
  setTimeout(function () { _llmTryInit(attempt + 1); }, 50);
})(0);
