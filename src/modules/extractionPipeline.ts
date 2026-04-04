/**
 * Extraction Pipeline — orchestrates the end-to-end metadata extraction flow.
 *
 * Text extraction → Prompt construction → LLM call → Schema validation →
 * Optional verification → Review dialog → Write to Zotero.
 */

declare const Zotero: any;
declare const Services: any;

import { addon } from "../addon";

function getZoteroPane(): any {
  try {
    return Zotero.getMainWindow()?.ZoteroPane;
  } catch (_) {
    return null;
  }
}
import { getPreferences, validatePreferences } from "./preferences";
import { extractText } from "./pdfExtractor";
import { callLLM, callLLMWithPDF, LLMConfig, LLMError } from "./llmClient";
import {
  SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildVerifyPrompt,
  buildRepairPrompt,
} from "./promptTemplates";
import { mapToZoteroSchema, MappedMetadata } from "./schemaMapping";
import { verifyDOI, verifyISBN, searchOpenAlex } from "./verification";
import {
  openReviewDialog,
  ReviewItem,
  ReviewResult,
} from "./reviewDialog";

/**
 * Run metadata extraction on the currently selected items.
 */
export async function extractMetadataForSelection(): Promise<void> {
  try {
    Zotero.debug("[LLM Metadata] Starting extraction...");

    // Validate preferences
    const prefError = validatePreferences();
    if (prefError) {
      Zotero.debug("[LLM Metadata] Pref validation failed: " + prefError);
      addon.showProgressWindow("LLM Metadata", prefError, "fail");
      return;
    }

    // Check privacy acceptance
    const prefs = getPreferences();
    Zotero.debug("[LLM Metadata] Privacy accepted: " + prefs.privacyAccepted);
    if (!prefs.privacyAccepted) {
      const accepted = showPrivacyDialog(prefs.provider);
      if (!accepted) {
        Zotero.debug("[LLM Metadata] Privacy declined.");
        return;
      }
      addon.setPref("privacyAccepted", true);
    }

    // Get selected items
    const zp = getZoteroPane();
    Zotero.debug("[LLM Metadata] ZoteroPane: " + (zp ? "found" : "NOT FOUND"));
    const items = zp?.getSelectedItems();
    Zotero.debug("[LLM Metadata] Selected items: " + (items ? items.length : "null"));
    if (!items || items.length === 0) {
      addon.showProgressWindow("LLM Metadata", "No items selected.", "fail");
      return;
    }

    // Handle standalone PDF attachments: create parent items for them
    const processedItems: any[] = [];
    for (const item of items) {
      if (item.isRegularItem()) {
        processedItems.push(item);
      } else if (item.isAttachment() && item.attachmentContentType === "application/pdf" && !item.parentItemID) {
        // Standalone PDF — create a parent item
        Zotero.debug("[LLM Metadata] Creating parent item for standalone PDF: " + item.attachmentFilename);
        try {
          const parentItem = new Zotero.Item("document");
          parentItem.libraryID = item.libraryID;
          parentItem.setField("title", item.attachmentFilename.replace(/\.pdf$/i, ""));
          await parentItem.saveTx();
          item.parentItemID = parentItem.id;
          await item.saveTx();
          Zotero.debug("[LLM Metadata] Created parent item " + parentItem.id + " for attachment " + item.id);
          processedItems.push(parentItem);
        } catch (e: any) {
          Zotero.debug("[LLM Metadata] Error creating parent item: " + e);
          addon.showProgressWindow("LLM Metadata", "Error creating parent item: " + e.message, "fail");
        }
      }
    }

    Zotero.debug("[LLM Metadata] Items to process: " + processedItems.length);
    if (processedItems.length === 0) {
      addon.showProgressWindow(
        "LLM Metadata",
        "No items to process. Select items with PDF attachments or standalone PDFs.",
        "fail"
      );
      return;
    }

    // Process items
    if (processedItems.length === 1) {
      await processSingleItem(processedItems[0]);
    } else {
      await processBatch(processedItems);
    }
  } catch (error: any) {
    Zotero.debug("[LLM Metadata] FATAL: " + error + "\n" + error.stack);
    addon.showProgressWindow("LLM Metadata", "Error: " + error.message, "fail");
  }
}

/**
 * Show a simple progress popup. Returns a handle to close it.
 */
function showProgress(text: string): { close: () => void } {
  const pw = new Zotero.ProgressWindow({ closeOnClick: true });
  pw.changeHeadline("LLM Metadata Extractor");
  pw.addDescription(text);
  pw.show();
  return {
    close() {
      try { pw.close(); } catch (_) {}
    },
  };
}

/**
 * Process a single item.
 */
async function processSingleItem(item: any): Promise<void> {
  const prefs = getPreferences();
  const title = item.getField("title") || "Untitled item";
  let progress = showProgress("Extracting text from PDF...");

  try {
    // Step 1: Extract text from PDF
    Zotero.debug("[LLM Metadata] Extracting text from: " + title);
    const extracted = await extractText(item, prefs.maxPages, prefs.enableOCR);
    const currentFields = getCurrentFields(item);

    const llmConfig: LLMConfig = {
      provider: prefs.provider,
      apiKey: prefs.apiKey,
      endpoint: prefs.endpoint,
      model: prefs.model,
      maxTokens: prefs.maxTokens,
      temperature: prefs.temperature,
    };

    let llmResponse;

    if (!extracted.hasText && extracted.pdfBase64) {
      // Scanned PDF — use vision fallback (send PDF directly to LLM)
      Zotero.debug("[LLM Metadata] No text layer. Using PDF vision fallback for: " + title +
        " (PDF base64 size: " + Math.round(extracted.pdfBase64.length / 1024) + " KB)");
      progress.close();
      progress = showProgress("Sending scanned PDF to LLM (vision)...");

      try {
        const visionPrompt = buildExtractionPrompt(
          "(This is a scanned PDF document. Please read the document images and extract metadata.)"
        );
        llmResponse = await callLLMWithPDF(llmConfig, extracted.pdfBase64, SYSTEM_PROMPT, visionPrompt);
      } catch (visionErr: any) {
        Zotero.debug("[LLM Metadata] Vision fallback error: " + visionErr + "\n" + (visionErr.stack || ""));
        progress.close();
        addon.showProgressWindow(
          "LLM Metadata",
          "Error sending PDF to LLM: " + visionErr.message,
          "fail"
        );
        return;
      }

    } else if (!extracted.hasText) {
      // No text and no PDF file available
      progress.close();
      addon.showProgressWindow(
        "LLM Metadata",
        (extracted as any).fileNotFound
          ? "PDF file not found on disk. Re-add the file to this Zotero item and try again."
          : "No text extracted and PDF file not accessible. Cannot extract metadata.",
        "fail"
      );
      return;

    } else {
      // Normal text-based extraction
      progress.close();
      progress = showProgress("Calling LLM...");
      Zotero.debug("[LLM Metadata] Calling LLM for: " + title);

      const hasExistingMetadata = Object.values(currentFields).some(
        (v) => v && v.trim() !== ""
      );

      const prompt = hasExistingMetadata
        ? buildVerifyPrompt(extracted.firstPages, currentFields)
        : buildExtractionPrompt(extracted.firstPages);

      try {
        llmResponse = await callLLM(llmConfig, prompt, SYSTEM_PROMPT);
      } catch (error: any) {
        if (
          error instanceof LLMError &&
          error.message.includes("Failed to parse")
        ) {
          progress.close();
          progress = showProgress("Retrying with repair prompt...");
          const repairPrompt = buildRepairPrompt(error.message);
          llmResponse = await callLLM(llmConfig, repairPrompt, SYSTEM_PROMPT);
        } else {
          throw error;
        }
      }
    }

    Zotero.debug("[LLM Metadata] LLM response received, mapping to schema...");

    // Step 4: Map to Zotero schema
    const mapped = mapToZoteroSchema(llmResponse.metadata);

    // Step 5: Optional verification
    let verification;
    if (prefs.verifyDOI && mapped.fields.DOI) {
      progress.close();
      progress = showProgress("Verifying DOI...");
      const firstAuthor = mapped.creators[0];
      const authorStr = firstAuthor
        ? `${firstAuthor.firstName} ${firstAuthor.lastName}`
        : undefined;
      verification = await verifyDOI(
        mapped.fields.DOI,
        mapped.fields.title || "",
        authorStr
      );
    }

    // Step 6: Present review dialog
    progress.close();
    Zotero.debug("[LLM Metadata] Opening review dialog...");

    const currentCreators = item.getCreators().map((c: any) => ({
      creatorType: c.creatorType,
      firstName: c.firstName || "",
      lastName: c.lastName || "",
    }));

    const reviewItems: ReviewItem[] = [
      {
        item,
        extracted: mapped,
        currentFields,
        currentCreators,
        verification,
      },
    ];

    openReviewDialog(reviewItems, async (results) => {
      // Step 7: Apply accepted changes (runs as callback after dialog closes)
      try {
        Zotero.debug("[LLM Metadata] Review callback: accepted=" +
          JSON.stringify(results[0]?.accepted) +
          " fields=" + (results[0] ? Object.keys(results[0].fields).length : "none"));

        if (results[0] && results[0].accepted) {
          Zotero.debug("[LLM Metadata] Applying result...");
          await applyResult(item, results[0]);
          Zotero.debug("[LLM Metadata] Applied successfully.");
          addon.showProgressWindow(
            "LLM Metadata",
            "Updated metadata for \"" + title + "\"",
            "success"
          );
        } else {
          Zotero.debug("[LLM Metadata] No results accepted.");
        }
      } catch (applyErr: any) {
        Zotero.debug("[LLM Metadata] Apply error: " + applyErr + "\n" + (applyErr.stack || ""));
        addon.showProgressWindow("LLM Metadata", "Error applying: " + applyErr.message, "fail");
      }
    });
  } catch (error: any) {
    Zotero.debug("[LLM Metadata] Extraction error: " + error + "\n" + error.stack);
    progress.close();
    addon.showProgressWindow(
      "LLM Metadata",
      "Error: " + error.message,
      "fail"
    );
  }
}

/**
 * Process a batch of items.
 */
async function processBatch(items: any[]): Promise<void> {
  const prefs = getPreferences();
  const reviewItems: ReviewItem[] = [];
  let progress = showProgress("Starting batch extraction...");

  const llmConfig: LLMConfig = {
    provider: prefs.provider,
    apiKey: prefs.apiKey,
    endpoint: prefs.endpoint,
    model: prefs.model,
    maxTokens: prefs.maxTokens,
    temperature: prefs.temperature,
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const title = item.getField("title") || "Untitled";

    try {
      progress.close();
      progress = showProgress(`(${i + 1}/${items.length}) Extracting: ${title}`);

      const extracted = await extractText(item, prefs.maxPages, prefs.enableOCR);

      if (!extracted.hasText) {
        Zotero.debug("[LLM Metadata] No text for: " + title);
        continue;
      }

      progress.close();
      progress = showProgress(`(${i + 1}/${items.length}) Calling LLM: ${title}`);

      const currentFields = getCurrentFields(item);
      const hasExisting = Object.values(currentFields).some(
        (v) => v && v.trim() !== ""
      );

      const prompt = hasExisting
        ? buildVerifyPrompt(extracted.firstPages, currentFields)
        : buildExtractionPrompt(extracted.firstPages);

      let llmResponse;
      try {
        llmResponse = await callLLM(llmConfig, prompt, SYSTEM_PROMPT);
      } catch (error: any) {
        if (error.message?.includes("Failed to parse")) {
          const repairPrompt = buildRepairPrompt(error.message);
          llmResponse = await callLLM(llmConfig, repairPrompt, SYSTEM_PROMPT);
        } else {
          throw error;
        }
      }

      const mapped = mapToZoteroSchema(llmResponse.metadata);

      let verification;
      if (prefs.verifyDOI && mapped.fields.DOI) {
        const firstAuthor = mapped.creators[0];
        const authorStr = firstAuthor
          ? `${firstAuthor.firstName} ${firstAuthor.lastName}`
          : undefined;
        verification = await verifyDOI(
          mapped.fields.DOI,
          mapped.fields.title || "",
          authorStr
        );
      }

      const currentCreators = item.getCreators().map((c: any) => ({
        creatorType: c.creatorType,
        firstName: c.firstName || "",
        lastName: c.lastName || "",
      }));

      reviewItems.push({
        item,
        extracted: mapped,
        currentFields,
        currentCreators,
        verification,
      });

      Zotero.debug("[LLM Metadata] Done: " + title);
    } catch (error: any) {
      Zotero.debug("[LLM Metadata] Error processing \"" + title + "\": " + error);
    }
  }

  progress.close();

  if (reviewItems.length === 0) {
    addon.showProgressWindow(
      "LLM Metadata",
      "No items could be processed.",
      "fail"
    );
    return;
  }

  // Open review dialog for all processed items
  openReviewDialog(reviewItems, async (results) => {
    try {
      let updatedCount = 0;
      await Zotero.DB.executeTransaction(async () => {
        for (let i = 0; i < results.length; i++) {
          if (results[i] && results[i].accepted) {
            await applyResult(reviewItems[i].item, results[i], false);
            updatedCount++;
          }
        }
      });

      if (updatedCount > 0) {
        addon.showProgressWindow(
          "LLM Metadata",
          "Updated metadata for " + updatedCount + " item(s).",
          "success"
        );
      } else {
        addon.showProgressWindow(
          "LLM Metadata",
          "No changes were applied.",
          "default"
        );
      }
    } catch (e: any) {
      Zotero.debug("[LLM Metadata] Batch apply error: " + e + "\n" + (e.stack || ""));
      addon.showProgressWindow("LLM Metadata", "Error: " + e.message, "fail");
    }
  });
}

/**
 * Get current field values for an item.
 */
function getCurrentFields(item: any): Record<string, string> {
  const fields: Record<string, string> = {};
  const fieldNames = [
    "title",
    "date",
    "abstractNote",
    "publicationTitle",
    "volume",
    "issue",
    "pages",
    "DOI",
    "ISBN",
    "ISSN",
    "url",
    "publisher",
    "place",
    "language",
    "rights",
    "extra",
    "shortTitle",
    "conferenceName",
    "proceedingsTitle",
    "bookTitle",
    "university",
    "thesisType",
    "institution",
    "reportNumber",
    "repository",
    "archiveID",
    "websiteTitle",
    "numPages",
    "edition",
    "series",
    "seriesNumber",
    "journalAbbreviation",
  ];

  for (const field of fieldNames) {
    try {
      const val = item.getField(field);
      if (val) fields[field] = val;
    } catch (_) {
      // Field not valid for this item type — skip
    }
  }

  return fields;
}

/**
 * Apply a review result to a Zotero item.
 */
async function applyResult(
  item: any,
  result: ReviewResult,
  useSaveTx: boolean = true
): Promise<void> {
  Zotero.debug("[LLM Metadata] applyResult: type=" + result.itemType +
    " fields=" + Object.keys(result.fields).join(",") +
    " creators=" + (result.creators ? result.creators.length : "null"));

  // Change item type if different
  if (result.itemType) {
    const newTypeID = Zotero.ItemTypes.getID(result.itemType);
    const currentTypeID = item.itemTypeID;
    if (newTypeID && newTypeID !== currentTypeID) {
      item.setType(newTypeID);
    }
  }

  // Set fields
  for (const [field, value] of Object.entries(result.fields)) {
    try {
      item.setField(field, value);
    } catch (e) {
      Zotero.debug(
        `[LLM Metadata] Could not set field "${field}": ${e}`
      );
    }
  }

  // Set creators
  if (result.creators && result.creators.length > 0) {
    item.setCreators(result.creators);
  }

  // Add tags (don't replace existing)
  if (result.tags && result.tags.length > 0) {
    for (const tag of result.tags) {
      item.addTag(tag);
    }
  }

  if (useSaveTx) {
    await item.saveTx();
  } else {
    await item.save();
  }
}

/**
 * Auto-extract metadata for a newly added item.
 * Called from the Zotero.Notifier observer when autoExtract is enabled.
 * Skips the review dialog and applies results directly (empty fields only).
 */
export async function autoExtractForItem(itemID: number): Promise<void> {
  const prefs = getPreferences();
  if (!prefs.autoExtract || !prefs.privacyAccepted) return;
  if (validatePreferences()) return; // Missing API key etc.

  let item = Zotero.Items.get(itemID);
  if (!item) return;

  // If this is a standalone PDF attachment, create a parent item
  if (item.isAttachment() && item.attachmentContentType === "application/pdf" && !item.parentItemID) {
    Zotero.debug("[LLM Metadata] Auto-extract: creating parent for standalone PDF " + itemID +
      " (" + item.attachmentFilename + ")");
    try {
      const parentItem = new Zotero.Item("document");
      parentItem.libraryID = item.libraryID;
      parentItem.setField("title", item.attachmentFilename.replace(/\.pdf$/i, ""));
      await parentItem.saveTx();
      item.parentItemID = parentItem.id;
      await item.saveTx();
      // Re-fetch to ensure fresh state
      item = Zotero.Items.get(parentItem.id);
      Zotero.debug("[LLM Metadata] Auto-extract: created parent " + parentItem.id);
    } catch (e: any) {
      Zotero.debug("[LLM Metadata] Auto-extract: error creating parent: " + e);
      return;
    }
  } else if (item.isAttachment()) {
    // Non-standalone attachment (already has parent) — skip, the parent will be handled
    Zotero.debug("[LLM Metadata] Auto-extract: skipping child attachment " + itemID);
    return;
  }

  // Only process regular items
  if (!item.isRegularItem()) return;

  // Check it has a PDF
  const attachmentIDs = item.getAttachments();
  const hasPDF = attachmentIDs.some((id: number) => {
    const att = Zotero.Items.get(id);
    return att && att.attachmentContentType === "application/pdf";
  });
  if (!hasPDF) return;

  // Note: auto-extract always overwrites since the item was just dragged in

  Zotero.debug("[LLM Metadata] Auto-extract: processing item " + item.id +
    " (" + (item.getField("title") || "untitled") + ")");
  addon.showProgressWindow("LLM Metadata", "Auto-extracting metadata...");

  try {
    const extracted = await extractText(item, prefs.maxPages, prefs.enableOCR);

    const llmConfig: LLMConfig = {
      provider: prefs.provider,
      apiKey: prefs.apiKey,
      endpoint: prefs.endpoint,
      model: prefs.model,
      maxTokens: prefs.maxTokens,
      temperature: prefs.temperature,
    };

    let llmResponse;
    if (!extracted.hasText && extracted.pdfBase64) {
      const visionPrompt = buildExtractionPrompt(
        "(This is a scanned PDF document. Please read the document images and extract metadata.)"
      );
      llmResponse = await callLLMWithPDF(llmConfig, extracted.pdfBase64, SYSTEM_PROMPT, visionPrompt);
    } else if (!extracted.hasText) {
      Zotero.debug("[LLM Metadata] Auto-extract: no text for item " + item.id);
      return;
    } else {
      const prompt = buildExtractionPrompt(extracted.firstPages);
      llmResponse = await callLLM(llmConfig, prompt, SYSTEM_PROMPT);
    }

    const mapped = mapToZoteroSchema(llmResponse.metadata);

    // Re-fetch item to get fresh state (another item in the queue may have modified it)
    item = Zotero.Items.get(item.id);
    if (!item) return;

    // Apply all extracted fields (this is a fresh drag-in, overwrite everything)
    if (mapped.itemType) {
      const newTypeID = Zotero.ItemTypes.getID(mapped.itemType);
      if (newTypeID) item.setType(newTypeID);
    }
    for (const [field, value] of Object.entries(mapped.fields)) {
      try {
        item.setField(field, value);
      } catch (_) {}
    }
    if (mapped.creators.length > 0) {
      item.setCreators(mapped.creators);
    }
    for (const tag of mapped.tags) {
      item.addTag(tag);
    }
    await item.saveTx();

    Zotero.debug("[LLM Metadata] Auto-extract: completed for item " + itemID);
    addon.showProgressWindow("LLM Metadata",
      "Auto-extracted metadata for \"" + (item.getField("title") || "Untitled") + "\"",
      "success");
  } catch (e: any) {
    Zotero.debug("[LLM Metadata] Auto-extract error: " + e + "\n" + (e.stack || ""));
  }
}

/**
 * Show the first-run privacy dialog. Synchronous (modal prompt).
 */
function showPrivacyDialog(provider: string): boolean {
  try {
    const ps = Services.prompt;
    return ps.confirm(
      Zotero.getMainWindow(),
      "LLM Metadata Extractor \u2014 Privacy Notice",
      "This plugin will send the text content of your PDF documents to the " +
      "configured AI provider's API (" + provider + ") for metadata extraction.\n\n" +
      "No data is stored by this plugin beyond what Zotero normally stores. " +
      "You can change the provider or use a local LLM in the plugin settings.\n\n" +
      "Do you want to continue?"
    );
  } catch (e) {
    Zotero.debug("[LLM Metadata] Privacy dialog error: " + e);
    // Fallback: just proceed
    return true;
  }
}
