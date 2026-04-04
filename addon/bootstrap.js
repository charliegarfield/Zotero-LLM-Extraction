/* eslint-disable no-undef */
// Zotero 7 bootstrapped plugin lifecycle

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  // Register chrome BEFORE awaiting anything, so chrome:// URLs are
  // available by the time the preference pane system initializes.
  var aomStartup = Cc[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Ci.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "llm-metadata", "content/"],
    ["locale", "llm-metadata", "en-US", "locale/en-US/"],
  ]);

  await Zotero.initializationPromise;

  // Load the main plugin script
  Services.scriptloader.loadSubScript(rootURI + "content/index.js");

  // Initialize the addon, passing rootURI
  if (typeof LLMMetadata !== "undefined" && LLMMetadata.default) {
    LLMMetadata.default.rootURI = rootURI;
    LLMMetadata.default.hooks.onStartup();
  }
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  if (typeof LLMMetadata !== "undefined" && LLMMetadata.default) {
    LLMMetadata.default.hooks.onShutdown();
  }

  // Clean up chrome resources
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}
