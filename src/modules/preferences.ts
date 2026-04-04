/**
 * Preferences management module.
 * Provides typed access to all plugin preferences.
 */

import { addon } from "../addon";

export type LLMProvider = "anthropic" | "openai" | "openai-compatible";
export type OverwriteMode = "never" | "ask" | "empty" | "always";

export interface PluginPreferences {
  provider: LLMProvider;
  apiKey: string;
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  verifyDOI: boolean;
  verifyISBN: boolean;
  overwriteMode: OverwriteMode;
  maxPages: number;
  enableOCR: boolean;
  privacyAccepted: boolean;
  autoExtract: boolean;
}

export function getPreferences(): PluginPreferences {
  return {
    provider: addon.getPref("provider") || "anthropic",
    apiKey: addon.getPref("apiKey") || "",
    endpoint: addon.getPref("endpoint") || "",
    model: addon.getPref("model") || "claude-sonnet-4-20250514",
    temperature: parseFloat(addon.getPref("temperature") || "0.0"),
    maxTokens: addon.getPref("maxTokens") || 2048,
    verifyDOI: addon.getPref("verifyDOI") !== false,
    verifyISBN: addon.getPref("verifyISBN") !== false,
    overwriteMode: addon.getPref("overwriteMode") || "ask",
    maxPages: addon.getPref("maxPages") || 5,
    enableOCR: addon.getPref("enableOCR") === true,
    privacyAccepted: addon.getPref("privacyAccepted") === true,
    autoExtract: addon.getPref("autoExtract") === true,
  };
}

export function setPreference<K extends keyof PluginPreferences>(
  key: K,
  value: PluginPreferences[K]
): void {
  addon.setPref(key, value);
}

/**
 * Validate that the minimum required preferences are set.
 * Returns an error message or null if valid.
 */
export function validatePreferences(): string | null {
  const prefs = getPreferences();

  if (!prefs.apiKey && prefs.provider !== "openai-compatible") {
    return "No API key configured. Go to Settings → LLM Metadata to add your API key.";
  }

  if (prefs.provider === "openai-compatible" && !prefs.endpoint) {
    return "Custom endpoint is required for OpenAI-compatible providers.";
  }

  return null;
}
