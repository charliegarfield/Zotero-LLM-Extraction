/**
 * Lifecycle hooks — called by bootstrap.js during plugin startup/shutdown.
 *
 * Registers context menus, toolbar buttons, and preference panes.
 */

declare const Zotero: any;
declare const Services: any;

import { extractMetadataForSelection, autoExtractForItem } from "./modules/extractionPipeline";
import { initReviewDialog } from "./modules/reviewDialog";
import { getPreferences } from "./modules/preferences";

let menuItemID: string | null = null;
let notifierID: string | null = null;

function getZoteroPane(): any {
  try {
    const win = Zotero.getMainWindow();
    return win?.ZoteroPane;
  } catch (_) {
    return null;
  }
}

export const hooks = {
  /**
   * Called when the plugin starts up.
   */
  onStartup(): void {
    Zotero.debug("[LLM Metadata] Plugin starting up...");

    // Register the preference pane
    this.registerPreferencePane();

    // Register UI once the main window is available
    const mainWindow = Zotero.getMainWindow();
    if (mainWindow && mainWindow.ZoteroPane) {
      this.onMainWindowLoad(mainWindow);
    }

    // Make the review dialog initializer globally available
    (Zotero as any)._llmMetadataInitReviewDialog = initReviewDialog;

    // Register notifier for auto-extract on new items
    this.registerNotifier();

    Zotero.debug("[LLM Metadata] Plugin started.");
  },

  /**
   * Called when the plugin shuts down.
   */
  onShutdown(): void {
    Zotero.debug("[LLM Metadata] Plugin shutting down...");

    // Remove menu items
    if (menuItemID) {
      try {
        const win = Zotero.getMainWindow();
        const doc = win?.document;
        const menuItem = doc?.getElementById(menuItemID);
        if (menuItem) {
          menuItem.remove();
        }
        const toolbarBtn = doc?.getElementById("llm-metadata-toolbar-button");
        if (toolbarBtn) {
          toolbarBtn.remove();
        }
      } catch (_) {
        // Window may already be closed
      }
    }

    // Unregister notifier
    if (notifierID) {
      Zotero.Notifier.unregisterObserver(notifierID);
      notifierID = null;
    }

    // Clean up globals
    delete (Zotero as any)._llmMetadataInitReviewDialog;

    Zotero.debug("[LLM Metadata] Plugin shut down.");
  },

  /**
   * Register UI elements when the main Zotero window loads.
   */
  onMainWindowLoad(win: any): void {
    const doc = win.document;

    // Add context menu item
    this.addContextMenu(doc);

    // Add toolbar button
    this.addToolbarButton(doc);
  },

  /**
   * Add "Extract Metadata with AI" to the item context menu.
   */
  addContextMenu(doc: any): void {
    const menuPopup = doc.getElementById("zotero-itemmenu");
    if (!menuPopup) {
      Zotero.debug("[LLM Metadata] Could not find item context menu");
      return;
    }

    const menuItem = doc.createXULElement("menuitem");
    menuItemID = "llm-metadata-extract-menuitem";
    menuItem.id = menuItemID;
    menuItem.setAttribute("label", "Extract Metadata with AI");
    menuItem.setAttribute(
      "tooltiptext",
      "Extract metadata from PDFs using AI"
    );
    menuItem.addEventListener("command", () => {
      extractMetadataForSelection();
    });

    // Insert before separator or at end
    const separator = doc.getElementById("zotero-itemmenu-separator");
    if (separator) {
      menuPopup.insertBefore(menuItem, separator);
    } else {
      menuPopup.appendChild(menuItem);
    }

    // Show/hide based on selection
    menuPopup.addEventListener("popupshowing", () => {
      const zp = getZoteroPane();
      if (!zp) return;
      const items = zp.getSelectedItems();
      const hasProcessableItems = items?.some((item: any) =>
        item.isRegularItem() ||
        (item.isAttachment() && item.attachmentContentType === "application/pdf")
      );
      menuItem.hidden = !hasProcessableItems;

      // Grey out if no API key
      const apiKey = Zotero.Prefs.get(
        "extensions.zotero.llm-metadata.apiKey",
        true
      );
      const provider = Zotero.Prefs.get(
        "extensions.zotero.llm-metadata.provider",
        true
      );
      if (!apiKey && provider !== "openai-compatible") {
        menuItem.disabled = true;
        menuItem.setAttribute(
          "tooltiptext",
          "No API key configured — open Settings to add one"
        );
      } else {
        menuItem.disabled = false;
        menuItem.setAttribute(
          "tooltiptext",
          "Extract metadata from PDFs using AI"
        );
      }
    });
  },

  /**
   * Add a toolbar button for extraction.
   */
  addToolbarButton(doc: any): void {
    const toolbarButton = doc.createXULElement("toolbarbutton");
    toolbarButton.id = "llm-metadata-toolbar-button";
    toolbarButton.setAttribute("label", "Extract Metadata");
    toolbarButton.setAttribute(
      "tooltiptext",
      "Extract metadata from PDFs using AI"
    );
    toolbarButton.setAttribute("class", "zotero-tb-button");
    // Use rootURI-based icon path
    const addon = (globalThis as any).LLMMetadata?.default;
    const rootURI = addon?.rootURI || "";
    toolbarButton.setAttribute(
      "image",
      rootURI + "content/icons/favicon.png"
    );
    toolbarButton.addEventListener("command", () => {
      extractMetadataForSelection();
    });

    const toolbar = doc.getElementById("zotero-items-toolbar");
    if (toolbar) {
      toolbar.appendChild(toolbarButton);
    }
  },

  /**
   * Register the preferences pane.
   */
  /**
   * Register a Zotero.Notifier observer to auto-extract metadata on new items.
   * Uses a queue to process items sequentially and avoid duplicates.
   */
  registerNotifier(): void {
    // Deduplication: track item IDs already being processed
    const pendingIDs = new Set<number>();

    const observer = {
      notify(event: string, type: string, ids: number[], _extraData: any) {
        if (type !== "item" || event !== "add") return;
        if (!getPreferences().autoExtract) return;

        // Delay to let Zotero finish processing the new items
        const mainWindow = Zotero.getMainWindow();
        mainWindow.setTimeout(() => {
          for (const id of ids) {
            try {
              if (pendingIDs.has(id)) {
                Zotero.debug("[LLM Metadata] Item " + id + " already processing, skipping.");
                continue;
              }

              const item = Zotero.Items.get(id);
              if (!item) continue;

              // Only process standalone PDF attachments.
              // Skip regular items — we'll process the parent after we create it
              // from autoExtractForItem. This prevents double-processing.
              if (item.isAttachment() &&
                  item.attachmentContentType === "application/pdf" &&
                  !item.parentItemID) {
                Zotero.debug("[LLM Metadata] New standalone PDF detected: " + id);
                pendingIDs.add(id);
                autoExtractForItem(id).finally(() => pendingIDs.delete(id));
              }
            } catch (e: any) {
              Zotero.debug("[LLM Metadata] Notifier error for item " + id + ": " + e);
            }
          }
        }, 3000); // 3s delay to let Zotero finish indexing
      },
    };

    notifierID = Zotero.Notifier.registerObserver(observer, ["item"], "llm-metadata");
    Zotero.debug("[LLM Metadata] Notifier registered: " + notifierID);
  },

  registerPreferencePane(): void {
    Zotero.PreferencePanes.register({
      pluginID: "llm-metadata@zotero-community.org",
      src: "chrome://llm-metadata/content/preferences.xhtml",
      scripts: ["chrome://llm-metadata/content/prefpane.js"],
      label: "LLM Metadata",
      image: "chrome://llm-metadata/content/icons/favicon.png",
    });
  },
};
