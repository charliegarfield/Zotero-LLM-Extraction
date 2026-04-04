/**
 * Base addon class — singleton that holds references to Zotero globals
 * and provides access to preference helpers.
 */

declare const Zotero: any;
declare const ZoteroPane: any;
declare const Components: any;
declare const Services: any;

export class Addon {
  public data = {
    alive: false,
    env: "production" as "development" | "production",
  };

  public id = "llm-metadata@zotero-community.org";
  public name = "LLM Metadata Extractor";
  public rootURI = "";

  private get _prefBranch(): any {
    return Services.prefs.getBranch("extensions.zotero.llm-metadata.");
  }

  /**
   * Get a preference value.
   */
  getPref(key: string): any {
    const branch = this._prefBranch;
    try {
      switch (branch.getPrefType(key)) {
        case branch.PREF_STRING: return branch.getStringPref(key);
        case branch.PREF_INT: return branch.getIntPref(key);
        case branch.PREF_BOOL: return branch.getBoolPref(key);
        default: return undefined;
      }
    } catch (_) {
      return undefined;
    }
  }

  /**
   * Set a preference value.
   */
  setPref(key: string, value: any): void {
    const branch = this._prefBranch;
    try {
      if (typeof value === "boolean") branch.setBoolPref(key, value);
      else if (typeof value === "number") branch.setIntPref(key, value);
      else branch.setStringPref(key, String(value));
    } catch (e) {
      Zotero.debug(`[LLM Metadata] Error setting pref ${key}: ${e}`);
    }
  }

  /**
   * Get the main Zotero window.
   */
  getMainWindow(): Window {
    return Zotero.getMainWindow();
  }

  /**
   * Show a progress notification in Zotero.
   */
  showProgressWindow(header: string, body: string, type: "default" | "success" | "fail" = "default"): void {
    const pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.changeHeadline(header);
    pw.addDescription(body);
    pw.show();
    pw.startCloseTimer(4000);
  }
}

export const addon = new Addon();
