/**
 * Review Dialog Controller
 *
 * Opens a modal dialog showing extracted metadata side-by-side with
 * current values. Users can accept, edit, or reject each field.
 */

declare const Zotero: any;

import { MappedMetadata } from "./schemaMapping";
import { verifyDOI } from "./verification";
import { VerificationResult } from "./verification";

export interface ReviewResult {
  accepted: boolean;
  fields: Record<string, string>;
  creators: Array<{
    creatorType: string;
    firstName: string;
    lastName: string;
  }> | null;
  tags: string[] | null;
  itemType: string;
}

export interface ReviewItem {
  item: any; // Zotero.Item
  extracted: MappedMetadata;
  currentFields: Record<string, string>;
  currentCreators: Array<{
    creatorType: string;
    firstName: string;
    lastName: string;
  }>;
  verification?: VerificationResult;
}

/**
 * Open the review dialog for a single item or batch of items.
 *
 * Uses a callback instead of Promise/await because Gecko's event loop
 * doesn't propagate Promise microtasks from dialog unload events.
 */
export function openReviewDialog(
  reviewItems: ReviewItem[],
  onComplete: (results: ReviewResult[]) => void
): void {
  const mainWindow = Zotero.getMainWindow();

  Zotero.debug("[LLM Metadata] openReviewDialog: " + reviewItems.length + " items, " +
    Object.keys(reviewItems[0]?.extracted?.fields || {}).join(", "));

  const dialogData = {
    reviewItems,
    results: [] as ReviewResult[],
    resolved: false,
    verifyDOI,
  };

  // Open NON-modal dialog
  const dialog = mainWindow.openDialog(
    "chrome://llm-metadata/content/reviewDialog.xhtml",
    "llm-metadata-review",
    "chrome,dialog,centerscreen,resizable=yes",
    dialogData
  );

  // When the dialog finishes loading, initialize it directly
  dialog.addEventListener("load", () => {
    Zotero.debug("[LLM Metadata] Dialog loaded, calling initReviewDialog...");
    try {
      initReviewDialog(dialog, dialogData);
      Zotero.debug("[LLM Metadata] Dialog initialized successfully.");
    } catch (e: any) {
      Zotero.debug("[LLM Metadata] Dialog init error: " + e + "\n" + (e.stack || ""));
    }
  });

  // When the dialog closes, call the completion callback directly
  dialog.addEventListener("unload", () => {
    Zotero.debug("[LLM Metadata] Dialog closed. resolved=" + dialogData.resolved +
      " results=" + dialogData.results.length);

    const results = dialogData.resolved
      ? dialogData.results
      : reviewItems.map(() => ({
          accepted: false,
          fields: {} as Record<string, string>,
          creators: null,
          tags: null,
          itemType: "",
        }));

    // Run on the main window's event loop
    mainWindow.setTimeout(() => {
      Zotero.debug("[LLM Metadata] Calling onComplete with " + results.length + " results");
      onComplete(results);
    }, 10);
  });
}

/**
 * Initialize the review dialog window (called from within the dialog via onload).
 */
export function initReviewDialog(
  window: any,
  dialogData: {
    reviewItems: ReviewItem[];
    results: ReviewResult[];
    resolved: boolean;
    verifyDOI: typeof verifyDOI;
  }
): void {
  const doc = window.document;
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  let currentIndex = 0;
  const items = dialogData.reviewItems;
  const isBatch = items.length > 1;

  Zotero.debug("[LLM Metadata] initReviewDialog called with " + items.length + " items");

  // Populate item type menulist
  const typePopup = doc.getElementById("review-item-type-popup");
  if (typePopup) {
    const commonTypes = [
      "journalArticle", "book", "bookSection", "conferencePaper",
      "thesis", "report", "preprint", "webpage", "manuscript",
      "document", "interview", "letter", "magazineArticle",
      "newspaperArticle", "blogPost", "presentation", "patent",
    ];
    for (const t of commonTypes) {
      const mi = doc.createXULElement
        ? doc.createXULElement("menuitem")
        : doc.createElement("menuitem");
      mi.setAttribute("label", t);
      mi.setAttribute("value", t);
      typePopup.appendChild(mi);
    }
  }

  // Helper to create HTML elements in a XUL document
  function h(tag: string, attrs?: Record<string, any>, children?: (Node | string)[]): HTMLElement {
    const el = doc.createElementNS(HTML_NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "style" && typeof v === "object") {
          Object.assign(el.style, v);
        } else if (k === "checked") {
          (el as any).checked = v;
        } else if (k.startsWith("data-")) {
          el.setAttribute(k, v);
        } else {
          el.setAttribute(k, String(v));
        }
      }
    }
    if (children) {
      for (const child of children) {
        if (typeof child === "string") {
          el.appendChild(doc.createTextNode(child));
        } else {
          el.appendChild(child);
        }
      }
    }
    return el;
  }

  // Show/hide batch controls
  if (isBatch) {
    const prevBtn = doc.getElementById("review-prev-btn");
    const nextBtn = doc.getElementById("review-next-btn");
    const acceptRemBtn = doc.getElementById("review-accept-remaining");
    if (prevBtn) prevBtn.hidden = false;
    if (nextBtn) nextBtn.hidden = false;
    if (acceptRemBtn) acceptRemBtn.hidden = false;
  }

  function renderItem(index: number): void {
    const reviewItem = items[index];
    const { extracted, currentFields } = reviewItem;

    Zotero.debug("[LLM Metadata] Rendering item " + index + ": " + extracted.itemType +
      ", fields: " + Object.keys(extracted.fields).join(", "));

    // Update batch counter
    const counter = doc.getElementById("review-batch-counter");
    if (counter) {
      counter.setAttribute("value", "Item " + (index + 1) + " of " + items.length);
    }

    // Confidence badge
    const badge = doc.getElementById("review-confidence");
    if (badge) {
      const conf = extracted.confidence;
      badge.setAttribute("value", "Confidence: " + (conf * 100).toFixed(0) + "%");
      badge.className = "confidence-badge " +
        (conf >= 0.8 ? "confidence-high" : conf >= 0.5 ? "confidence-medium" : "confidence-low");
    }

    // Populate item type selector
    const typeSelector = doc.getElementById("review-item-type-selector") as any;
    if (typeSelector) {
      typeSelector.value = extracted.itemType;
    }

    // Populate fields table
    const tbody = doc.getElementById("review-fields-body");
    if (!tbody) {
      Zotero.debug("[LLM Metadata] review-fields-body NOT FOUND");
      return;
    }
    // Clear existing rows
    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild);
    }

    const allFieldKeys = new Set([
      ...Object.keys(extracted.fields),
      ...Object.keys(currentFields),
    ]);

    for (const field of allFieldKeys) {
      const currentVal = currentFields[field] || "";
      const extractedVal = extracted.fields[field] || "";
      if (!extractedVal && !currentVal) continue;

      const rowClass = (extractedVal && !currentVal) ? "field-new"
        : (extractedVal && currentVal && extractedVal !== currentVal) ? "field-conflict"
        : "";

      const checkbox = h("input", {
        type: "checkbox",
        "data-field": field,
        class: "field-checkbox",
        checked: !currentVal || currentVal.trim() === "",
      });

      const textInput = h("input", {
        type: "text",
        value: extractedVal,
        "data-field": field,
        class: "extracted-value-input",
        style: { width: "100%" },
      });
      // Set value via property (attribute won't update for input)
      (textInput as any).value = extractedVal;

      const tr = h("tr", rowClass ? { class: rowClass } : {}, [
        h("td", { style: { padding: "6px 8px" } }, [checkbox]),
        h("td", { style: { padding: "6px 8px", fontWeight: "bold" } }, [field]),
        h("td", {
          style: { padding: "6px 8px", color: currentVal ? "#333" : "#999" }
        }, [currentVal || "(empty)"]),
        h("td", { style: { padding: "6px 8px" } }, [textInput]),
      ]);

      tbody.appendChild(tr);
    }

    // Render creators
    const creatorsContainer = doc.getElementById("review-creators-container");
    if (creatorsContainer) {
      while (creatorsContainer.firstChild) {
        creatorsContainer.removeChild(creatorsContainer.firstChild);
      }
      if (extracted.creators.length === 0) {
        creatorsContainer.appendChild(doc.createTextNode("(No creators extracted)"));
      } else {
        for (const creator of extracted.creators) {
          const entry = h("div", { class: "creator-entry" }, [
            h("span", { class: "creator-type" }, [creator.creatorType]),
            h("span", {}, [creator.firstName + " " + creator.lastName]),
          ]);
          creatorsContainer.appendChild(entry);
        }
      }
    }

    // Render tags
    const tagsContainer = doc.getElementById("review-tags-container");
    if (tagsContainer) {
      while (tagsContainer.firstChild) {
        tagsContainer.removeChild(tagsContainer.firstChild);
      }
      if (extracted.tags.length === 0) {
        tagsContainer.appendChild(doc.createTextNode("(No tags extracted)"));
      } else {
        for (const tag of extracted.tags) {
          tagsContainer.appendChild(h("span", { class: "tag-chip" }, [tag]));
        }
      }
    }

    // Verification status
    const verStatus = doc.getElementById("review-verification-text");
    const verifyBtn = doc.getElementById("review-verify-doi-btn");
    if (verStatus && reviewItem.verification) {
      verStatus.setAttribute("value", reviewItem.verification.message);
    }
    if (verifyBtn) {
      verifyBtn.hidden = !extracted.fields.DOI;
    }
  }

  function collectResult(): ReviewResult {
    const reviewItem = items[currentIndex];
    const fields: Record<string, string> = {};

    const checkboxes = doc.querySelectorAll(".field-checkbox");
    Zotero.debug("[LLM Metadata] collectResult: found " + checkboxes.length + " checkboxes");

    for (const cb of checkboxes) {
      const isChecked = (cb as any).checked;
      const field = (cb as any).getAttribute("data-field");
      if (isChecked) {
        const input = doc.querySelector(
          '.extracted-value-input[data-field="' + field + '"]'
        ) as any;
        if (input && input.value) {
          fields[field] = input.value;
          Zotero.debug("[LLM Metadata]   + " + field + " = " + input.value.substring(0, 50));
        } else {
          Zotero.debug("[LLM Metadata]   - " + field + ": input not found or empty");
        }
      }
    }

    const acceptCreators = doc.getElementById("review-accept-creators") as any;
    const acceptTags = doc.getElementById("review-accept-tags") as any;
    const typeSelector = doc.getElementById("review-item-type-selector") as any;

    const result: ReviewResult = {
      accepted: true,
      fields,
      creators: acceptCreators?.checked ? reviewItem.extracted.creators : null,
      tags: acceptTags?.checked ? reviewItem.extracted.tags : null,
      itemType: typeSelector?.value || reviewItem.extracted.itemType,
    };

    Zotero.debug("[LLM Metadata] collectResult: " + Object.keys(fields).length +
      " fields, creators=" + (result.creators ? result.creators.length : "null") +
      ", type=" + result.itemType);

    return result;
  }

  // Wire up button handlers via addEventListener (oncommand attributes don't work)
  function addClick(id: string, handler: () => void): void {
    const el = doc.getElementById(id);
    if (!el) {
      Zotero.debug("[LLM Metadata] Button NOT FOUND: " + id);
      return;
    }
    Zotero.debug("[LLM Metadata] Wiring button: " + id);
    // Remove oncommand attribute to prevent it from swallowing events
    el.removeAttribute("oncommand");
    // Try every event type that could work for XUL buttons
    const wrappedHandler = () => {
      Zotero.debug("[LLM Metadata] Button pressed: " + id);
      handler();
    };
    el.addEventListener("command", wrappedHandler);
    el.addEventListener("click", wrappedHandler);
  }

  addClick("review-accept-all", () => {
    const checkboxes = doc.querySelectorAll(".field-checkbox");
    for (const cb of checkboxes) {
      (cb as any).checked = true;
    }
  });

  addClick("review-accept-empty", () => {
    const checkboxes = doc.querySelectorAll(".field-checkbox");
    for (const cb of checkboxes) {
      const field = (cb as any).getAttribute("data-field");
      const currentVal = items[currentIndex].currentFields[field];
      (cb as any).checked = !currentVal || currentVal.trim() === "";
    }
  });

  addClick("review-apply-btn", () => {
    Zotero.debug("[LLM Metadata] Apply clicked");
    dialogData.results[currentIndex] = collectResult();
    dialogData.resolved = true;
    window.close();
  });

  addClick("review-cancel-btn", () => {
    window.close();
  });

  addClick("review-prev-btn", () => {
    if (currentIndex > 0) {
      dialogData.results[currentIndex] = collectResult();
      currentIndex--;
      renderItem(currentIndex);
    }
  });

  addClick("review-next-btn", () => {
    if (currentIndex < items.length - 1) {
      dialogData.results[currentIndex] = collectResult();
      currentIndex++;
      renderItem(currentIndex);
    }
  });

  addClick("review-accept-remaining", () => {
    dialogData.results[currentIndex] = collectResult();
    for (let i = currentIndex + 1; i < items.length; i++) {
      const ri = items[i];
      const fields: Record<string, string> = {};
      for (const [key, val] of Object.entries(ri.extracted.fields)) {
        if (!ri.currentFields[key] || ri.currentFields[key].trim() === "") {
          fields[key] = val;
        }
      }
      dialogData.results[i] = {
        accepted: true,
        fields,
        creators: ri.extracted.creators,
        tags: ri.extracted.tags,
        itemType: ri.extracted.itemType,
      };
    }
    dialogData.resolved = true;
    window.close();
  });

  addClick("review-verify-doi-btn", async () => {
    const reviewItem = items[currentIndex];
    const doi = reviewItem.extracted.fields.DOI;
    if (!doi) return;

    const verStatus = doc.getElementById("review-verification-text");
    if (verStatus) verStatus.setAttribute("value", "Verifying...");

    const firstAuthor = reviewItem.extracted.creators[0];
    const authorStr = firstAuthor
      ? firstAuthor.firstName + " " + firstAuthor.lastName
      : undefined;

    const result = await dialogData.verifyDOI(
      doi,
      reviewItem.extracted.fields.title || "",
      authorStr
    );

    reviewItem.verification = result;
    if (verStatus) verStatus.setAttribute("value", result.message);

    const statusBox = doc.getElementById("review-verification-status");
    if (statusBox) {
      statusBox.className = result.verified
        ? "verification-verified"
        : result.matchScore > 0
          ? "verification-mismatch"
          : "verification-error";
    }
  });

  // Also keep window.llmMetadataReview for any remaining oncommand refs
  window.llmMetadataReview = {
    acceptAll() { doc.getElementById("review-accept-all")?.click(); },
    acceptEmptyOnly() { doc.getElementById("review-accept-empty")?.click(); },
    apply() { doc.getElementById("review-apply-btn")?.click(); },
    prevItem() { doc.getElementById("review-prev-btn")?.click(); },
    nextItem() { doc.getElementById("review-next-btn")?.click(); },
    acceptAllRemaining() { doc.getElementById("review-accept-remaining")?.click(); },
    verifyDOI() { doc.getElementById("review-verify-doi-btn")?.click(); },
  };

  // Initial render
  renderItem(0);
}
