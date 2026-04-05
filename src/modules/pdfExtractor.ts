/**
 * PDF Text Extractor
 *
 * Extracts text from PDF attachments using Zotero's built-in APIs.
 * When no text is available (scanned PDFs), reads the PDF as base64
 * so it can be sent directly to a vision-capable LLM.
 */

declare const Zotero: any;
declare const IOUtils: any;

export interface ExtractedText {
  fullText: string;
  firstPages: string;
  pageCount: number;
  isOCR: boolean;
  hasText: boolean;
  /** Base64-encoded PDF for vision fallback (only set when hasText is false) */
  pdfBase64?: string;
  /** Base64-encoded PNG images of first N pages (for OpenAI vision) */
  pageImages?: string[];
  pdfFilePath?: string;
  /** True if the PDF file is missing from disk */
  fileNotFound?: boolean;
}

/**
 * Extract text from the first PDF attachment of a Zotero item.
 */
export async function extractText(
  item: any,
  maxPages: number = 5,
  enableOCR: boolean = false
): Promise<ExtractedText> {
  const attachmentIDs: number[] = item.getAttachments();

  let pdfAttachment: any = null;
  for (const id of attachmentIDs) {
    const att = Zotero.Items.get(id);
    if (att && att.attachmentContentType === "application/pdf") {
      pdfAttachment = att;
      break;
    }
  }

  if (!pdfAttachment) {
    Zotero.debug("[LLM Metadata] No PDF attachment found for item: " + item.id);
    return { fullText: "", firstPages: "", pageCount: 0, isOCR: false, hasText: false };
  }

  Zotero.debug("[LLM Metadata] Found PDF attachment: " + pdfAttachment.id +
    " (" + pdfAttachment.attachmentFilename + ")");

  // Try to get the file path
  let filePath: string = "";
  try {
    const fp = await pdfAttachment.getFilePathAsync();
    if (fp && fp !== false) {
      filePath = fp;
    }
  } catch (e) {
    Zotero.debug("[LLM Metadata] getFilePathAsync error: " + e);
  }

  // Fallback: construct path manually from storage directory
  if (!filePath) {
    try {
      const storageDir = Zotero.DataDirectory.dir;
      const key = pdfAttachment.key;
      const filename = pdfAttachment.attachmentFilename;
      if (storageDir && key && filename) {
        const candidatePath = storageDir + "/storage/" + key + "/" + filename;
        // Check if file exists using OS.Path or PathUtils
        let exists = false;
        try {
          if (typeof IOUtils !== "undefined") {
            exists = await IOUtils.exists(candidatePath);
          }
        } catch (_) {}
        if (!exists) {
          // Also try Zotero.File
          try {
            const file = Zotero.File.pathToFile(candidatePath);
            exists = file && file.exists();
          } catch (_) {}
        }
        Zotero.debug("[LLM Metadata] Manual path check: " + candidatePath + " exists=" + exists);
        if (exists) {
          filePath = candidatePath;
        }
      }
    } catch (e) {
      Zotero.debug("[LLM Metadata] Manual path construction error: " + e);
    }
  }

  if (!filePath) {
    Zotero.debug("[LLM Metadata] PDF file not accessible. " +
      "The attachment may need to be re-synced or the file re-added.");
    return {
      fullText: "",
      firstPages: "",
      pageCount: 0,
      isOCR: false,
      hasText: false,
      fileNotFound: true,
    } as ExtractedText;
  }

  Zotero.debug("[LLM Metadata] PDF file path: " + filePath);

  // Try text extraction
  let fullText = "";
  try {
    fullText = await pdfAttachment.attachmentText;
    Zotero.debug("[LLM Metadata] attachmentText: " +
      (fullText ? fullText.length + " chars" : "empty"));
  } catch (e) {
    Zotero.debug("[LLM Metadata] attachmentText error: " + e);
  }

  // If we have text, return it
  if (fullText && fullText.trim().length >= 100) {
    const firstPages = extractFirstPages(fullText, maxPages);
    const pageCount = estimatePageCount(fullText);
    return { fullText, firstPages, pageCount, isOCR: false, hasText: true };
  }

  // No text available — read the PDF as base64 for vision-based extraction
  Zotero.debug("[LLM Metadata] No usable text (" + (fullText ? fullText.trim().length : 0) +
    " chars). Reading PDF for vision fallback...");
  try {
    if (filePath) {
      let pdfBytes: Uint8Array;
      // Try IOUtils (Zotero 7 / Firefox 115+)
      if (typeof IOUtils !== "undefined") {
        Zotero.debug("[LLM Metadata] Reading via IOUtils...");
        pdfBytes = await IOUtils.read(filePath);
      } else {
        // Fallback: use Zotero.File
        Zotero.debug("[LLM Metadata] IOUtils not available, trying Zotero.File...");
        const contents = await Zotero.File.getBinaryContentsAsync(filePath);
        pdfBytes = new Uint8Array(contents.length);
        for (let i = 0; i < contents.length; i++) {
          pdfBytes[i] = contents.charCodeAt(i);
        }
      }
      const pdfBase64 = uint8ArrayToBase64(pdfBytes);
      Zotero.debug("[LLM Metadata] PDF read as base64: " +
        Math.round(pdfBase64.length / 1024) + " KB base64 (" +
        Math.round(pdfBytes.length / 1024) + " KB raw)");

      // Also render page images for OpenAI vision support
      const pageImages = await renderPageImages(pdfAttachment, maxPages);

      return {
        fullText: "",
        firstPages: "",
        pageCount: 0,
        isOCR: false,
        hasText: false,
        pdfBase64,
        pageImages,
        pdfFilePath: filePath,
      };
    }
  } catch (e: any) {
    Zotero.debug("[LLM Metadata] Error reading PDF file: " + e + "\n" + (e.stack || ""));
  }

  return { fullText: "", firstPages: "", pageCount: 0, isOCR: false, hasText: false };
}

/**
 * Render the first N pages of a PDF as PNG images (base64-encoded).
 * Uses Zotero.PDFWorker if available, otherwise returns empty array.
 */
async function renderPageImages(pdfAttachment: any, maxPages: number): Promise<string[]> {
  const images: string[] = [];
  try {
    if (!Zotero.PDFWorker || !Zotero.PDFWorker.renderAttachmentAnnotations) {
      // Try an alternative: use the PDF renderer directly
      Zotero.debug("[LLM Metadata] PDFWorker.renderAttachmentAnnotations not available, " +
        "trying alternative page rendering...");

      // Zotero 7 has Zotero.PDFRenderer or we can use pdf.js via PDFWorker
      if (Zotero.PDFWorker && Zotero.PDFWorker.getFullText) {
        // PDFWorker exists but may not have page rendering
        // Fall back: we already have pdfBase64, OpenAI-compatible providers
        // that support vision can use a different approach
        Zotero.debug("[LLM Metadata] Page image rendering not supported in this Zotero version.");
        return [];
      }
      return [];
    }

    // Render pages using PDFWorker
    const filePath = await pdfAttachment.getFilePathAsync();
    if (!filePath) return [];

    for (let page = 0; page < maxPages; page++) {
      try {
        const result = await Zotero.PDFWorker.renderPage(
          pdfAttachment.id, page, { scale: 1.5 }
        );
        if (result && result.data) {
          images.push(uint8ArrayToBase64(new Uint8Array(result.data)));
          Zotero.debug("[LLM Metadata] Rendered page " + (page + 1) + " as image");
        }
      } catch (pageErr: any) {
        // Likely past the end of the document
        if (page === 0) {
          Zotero.debug("[LLM Metadata] Failed to render even page 1: " + pageErr);
        }
        break;
      }
    }
  } catch (e: any) {
    Zotero.debug("[LLM Metadata] Page rendering error: " + e);
  }

  Zotero.debug("[LLM Metadata] Rendered " + images.length + " page images");
  return images;
}

/**
 * Convert a Uint8Array to a base64 string.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

/**
 * Extract approximately the first N pages of text.
 */
function extractFirstPages(text: string, maxPages: number): string {
  const ffPages = text.split("\f");
  if (ffPages.length > 1) {
    return ffPages.slice(0, maxPages).join("\n\n--- PAGE BREAK ---\n\n");
  }

  const wordsPerPage = 800;
  const maxWords = wordsPerPage * maxPages;
  const words = text.split(/\s+/);

  if (words.length <= maxWords) {
    return text;
  }

  return words.slice(0, maxWords).join(" ");
}

/**
 * Estimate page count from text length.
 */
function estimatePageCount(text: string): number {
  const ffPages = text.split("\f");
  if (ffPages.length > 1) {
    return ffPages.length;
  }

  const wordCount = text.split(/\s+/).length;
  return Math.max(1, Math.ceil(wordCount / 800));
}
