# Zotero LLM Metadata Extractor — Extension Specification

**Version:** 0.1.0 (Draft)
**Plugin ID:** `llm-metadata@zotero-community.org`
**Target Platform:** Zotero 7+ (bootstrapped plugin architecture)
**License:** AGPL-3.0 (consistent with Zotero ecosystem norms)

---

## 1. Problem Statement

Zotero's existing metadata retrieval depends on structured identifiers (DOIs, ISBNs) or web translators. When these fail — as they commonly do for preprints, working papers, dissertations, government reports, scanned documents, conference proceedings, and foreign-language publications — users must manually fill every citation field. This is tedious, error-prone, and scales badly.

Large language models are well-suited to extracting structured bibliographic metadata from unstructured document text because citation information tends to appear in predictable locations (title pages, headers, footers, colophons) and follows recognizable formatting conventions. An LLM can parse messy, inconsistent, or non-standard documents that rule-based systems struggle with.

**This plugin bridges the gap:** it sends document text to an LLM, receives structured metadata back, and writes it into Zotero's item fields — with user review before committing.

---

## 2. Goals and Non-Goals

### Goals

- Extract bibliographic metadata from attached PDFs (and optionally other attachment types) using an LLM API.
- Map extracted metadata onto the correct Zotero item type and fields.
- Present extracted metadata to the user for review and selective acceptance before writing to the database.
- Support batch processing of multiple selected items.
- Cross-reference extracted identifiers (DOI, ISBN) against external APIs (CrossRef, OpenAlex, Google Books) for verification.
- Be LLM-provider-agnostic, with first-class support for the Anthropic (Claude) and OpenAI APIs, plus an "OpenAI-compatible" generic endpoint for local models.

### Non-Goals

- Replacing Zotero's existing web translators or identifier-based lookup.
- Full-text summarization, Q&A, or chat-style research assistance (see Aria for that).
- Functioning without an internet connection (unless the user configures a local LLM endpoint).
- Handling DRM-protected or encrypted PDFs.

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                     Zotero Client                    │
│                                                      │
│  ┌────────────┐   ┌──────────────┐   ┌────────────┐ │
│  │ Context    │──▶│  Extraction  │──▶│  Review UI │ │
│  │ Menu /     │   │  Pipeline    │   │  (Dialog)  │ │
│  │ Toolbar    │   │              │   │            │ │
│  └────────────┘   └──────┬───────┘   └─────┬──────┘ │
│                          │                 │        │
│                    ┌─────▼─────┐     ┌─────▼──────┐ │
│                    │ PDF Text  │     │ Zotero     │ │
│                    │ Extractor │     │ Item API   │ │
│                    └─────┬─────┘     │ (setField, │ │
│                          │           │ setCreators│ │
│                    ┌─────▼─────┐     │ saveTx)    │ │
│                    │ LLM       │     └────────────┘ │
│                    │ Client    │                     │
│                    │ (HTTP)    │                     │
│                    └─────┬─────┘                     │
└──────────────────────────┼───────────────────────────┘
                           │
              ┌────────────▼────────────────┐
              │   LLM Provider API          │
              │  (Anthropic / OpenAI /      │
              │   Local / Custom)           │
              └────────────┬────────────────┘
                           │
              ┌────────────▼────────────────┐
              │  Verification APIs          │
              │  (CrossRef, OpenAlex,       │
              │   Google Books — optional)  │
              └─────────────────────────────┘
```

The plugin consists of five core modules:

1. **PDF Text Extractor** — Pulls text from PDF attachments using Zotero's built-in `attachment.attachmentText` API (which uses pdf.js internally). Falls back to sending the first N pages as images for scanned/image-only PDFs.
2. **LLM Client** — A provider-agnostic HTTP client that formats prompts, sends requests, and parses structured JSON responses from the configured LLM API.
3. **Extraction Pipeline** — Orchestrates the end-to-end flow: text extraction → prompt construction → LLM call → response parsing → optional verification → presentation.
4. **Review UI** — A modal dialog showing extracted fields side-by-side with current values, letting the user accept, edit, or reject each field individually.
5. **Verification Service** — Optionally cross-references extracted DOIs/ISBNs against CrossRef or OpenAlex to validate or enrich the LLM's output.

---

## 4. Plugin Structure (File Layout)

The plugin follows the standard Zotero 7 bootstrapped plugin template (based on `windingwind/zotero-plugin-template`):

```
zotero-llm-metadata/
├── addon/
│   ├── bootstrap.js              # Plugin lifecycle (startup, shutdown, install, uninstall)
│   ├── manifest.json             # WebExtension-style manifest
│   ├── prefs.js                  # Default preference values
│   ├── content/
│   │   ├── icons/
│   │   │   ├── favicon.png
│   │   │   └── favicon@0.5x.png
│   │   ├── preferences.xhtml     # Preferences pane UI
│   │   ├── reviewDialog.xhtml    # Metadata review dialog UI
│   │   └── zoteroPane.css        # Custom styles
│   └── locale/
│       ├── en-US/
│       │   ├── addon.ftl
│       │   ├── preferences.ftl
│       │   └── reviewDialog.ftl
│       └── zh-CN/
│           └── ...
├── src/
│   ├── index.ts                  # Main entry point
│   ├── hooks.ts                  # Lifecycle hooks
│   ├── addon.ts                  # Base addon class
│   └── modules/
│       ├── pdfExtractor.ts       # PDF text extraction
│       ├── llmClient.ts          # LLM API communication
│       ├── extractionPipeline.ts # Orchestration logic
│       ├── reviewDialog.ts       # Review dialog controller
│       ├── verification.ts       # CrossRef/OpenAlex verification
│       ├── promptTemplates.ts    # LLM prompt templates
│       ├── schemaMapping.ts      # Zotero schema ↔ LLM output mapping
│       └── preferences.ts        # Preferences management
├── package.json
├── tsconfig.json
└── .env.example
```

### manifest.json

```json
{
  "manifest_version": 2,
  "name": "LLM Metadata Extractor",
  "version": "0.1.0",
  "description": "Use AI to extract and fill citation metadata from PDFs",
  "author": "Zotero Community",
  "icons": {
    "48": "content/icons/favicon.png",
    "96": "content/icons/favicon@2x.png"
  },
  "applications": {
    "zotero": {
      "id": "llm-metadata@zotero-community.org",
      "update_url": "https://github.com/<org>/<repo>/releases/download/release/update.json",
      "strict_min_version": "7.0",
      "strict_max_version": "7.*"
    }
  }
}
```

---

## 5. Core Module Specifications

### 5.1 PDF Text Extractor (`pdfExtractor.ts`)

**Responsibility:** Given a Zotero item, retrieve text from its PDF attachment(s).

**API:**

```typescript
interface ExtractedText {
  fullText: string;          // Complete extracted text
  firstPages: string;        // First ~3 pages (for LLM context window efficiency)
  pageCount: number;
  isOCR: boolean;            // Whether the text came from OCR vs native text
  hasText: boolean;          // Whether any text was extractable
}

async function extractText(item: Zotero.Item): Promise<ExtractedText>
```

**Implementation strategy:**

1. Get attachment IDs via `item.getAttachments()`.
2. Find the first PDF attachment by checking `attachment.attachmentContentType === 'application/pdf'`.
3. Retrieve full text via `await attachment.attachmentText`.
4. If the text is empty or very short (< 100 characters), flag `isOCR: false, hasText: false`. In this case, the pipeline module will decide whether to use Zotero's built-in OCR or to skip.
5. Extract the first ~3 pages by splitting on common page-break heuristics (form feed characters, page number patterns) or by taking the first ~3000 tokens of text.
6. For metadata extraction, the first few pages are usually sufficient — title pages, copyright pages, and headers contain the densest bibliographic information.

**Scanned PDF handling:** If no text is available and the user has enabled OCR in preferences, use Zotero's built-in OCR capabilities (if available in the user's Zotero version) or suggest the user install the Zotero-OCR plugin. As a future enhancement, the plugin could send page images directly to a vision-capable LLM.

### 5.2 LLM Client (`llmClient.ts`)

**Responsibility:** Send prompts to a configured LLM provider and return parsed responses.

**Supported providers:**

| Provider | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Anthropic (Claude) | `https://api.anthropic.com/v1/messages` | API key in `x-api-key` header | Recommended. Claude excels at structured extraction. |
| OpenAI | `https://api.openai.com/v1/chat/completions` | Bearer token | GPT-4o or later recommended. |
| OpenAI-Compatible | User-configured URL | Bearer token | Covers Ollama, LM Studio, vLLM, llama.cpp, etc. |

**API:**

```typescript
interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'openai-compatible';
  apiKey: string;
  endpoint?: string;         // Required for openai-compatible
  model: string;             // e.g. "claude-sonnet-4-20250514", "gpt-4o"
  maxTokens: number;         // Default: 2048
  temperature: number;       // Default: 0.0 (deterministic extraction)
}

interface LLMResponse {
  metadata: ExtractedMetadata;
  confidence: number;        // 0-1, self-reported by the LLM
  rawResponse: string;       // For debugging
}

async function callLLM(
  config: LLMConfig,
  prompt: string,
  systemPrompt: string
): Promise<LLMResponse>
```

**Implementation notes:**

- Use `Zotero.HTTP.request()` (Zotero's built-in HTTP client, which respects proxy settings) or `XMLHttpRequest` for API calls.
- Temperature should default to 0.0 for maximum determinism in extraction tasks.
- Implement exponential backoff with 3 retries on transient failures (429, 500, 502, 503).
- Enforce a timeout of 30 seconds per request.
- Response parsing should expect JSON wrapped in a code fence or returned directly, and handle both cases.

### 5.3 Prompt Templates (`promptTemplates.ts`)

**Responsibility:** Construct the system prompt and user prompt for the LLM.

The prompt is the most critical component of the plugin. It must:

1. Instruct the LLM to extract specific Zotero-compatible fields.
2. Specify the expected JSON output schema.
3. Handle ambiguity (e.g., "is this a journal article or a conference paper?").
4. Discourage hallucination (especially for DOIs and ISBNs).

**System prompt (abbreviated):**

```
You are a bibliographic metadata extraction engine. Given text extracted 
from a scholarly document, you produce structured citation metadata in 
JSON format compatible with the Zotero reference manager.

Rules:
- Only extract information explicitly present in the document text.
- Never fabricate DOIs, ISBNs, ISSNs, or other identifiers. If you 
  cannot find one, set the field to null.
- If you are uncertain about a field, set it to null rather than guessing.
- For author names, preserve the exact form given in the document.
- Determine the most appropriate Zotero item type from this list:
  [journalArticle, book, bookSection, conferencePaper, thesis, report,
   preprint, webpage, manuscript, document, ...].
- Return ONLY valid JSON. No commentary, no markdown fences.
```

**User prompt template:**

```
Extract bibliographic metadata from the following document text. Return
a JSON object with this structure:

{
  "itemType": "<Zotero item type>",
  "title": "<string>",
  "creators": [
    {
      "creatorType": "author|editor|translator|...",
      "firstName": "<string>",
      "lastName": "<string>"
    }
  ],
  "date": "<date string, preferably ISO>",
  "abstractNote": "<string or null>",
  "publicationTitle": "<journal/proceedings name or null>",
  "volume": "<string or null>",
  "issue": "<string or null>",
  "pages": "<string or null>",
  "DOI": "<string or null — ONLY if explicitly printed in the text>",
  "ISBN": "<string or null — ONLY if explicitly printed in the text>",
  "ISSN": "<string or null>",
  "url": "<string or null>",
  "publisher": "<string or null>",
  "place": "<string or null>",
  "language": "<ISO 639-1 code or null>",
  "rights": "<string or null>",
  "extra": "<any additional metadata as key: value lines, or null>",
  "tags": ["<keyword1>", "<keyword2>", ...],
  "confidence": <0.0-1.0 overall confidence>
}

--- DOCUMENT TEXT ---
{document_text}
```

**Item-type-specific fields:** After the LLM returns an `itemType`, a second pass can request type-specific fields. For instance, if `itemType` is `thesis`, we additionally request `thesisType` and `university`. This is handled by the extraction pipeline.

### 5.4 Schema Mapping (`schemaMapping.ts`)

**Responsibility:** Map between the LLM's JSON output and Zotero's internal field names.

Zotero's canonical schema is available at `https://api.zotero.org/schema` and defines which fields are valid for each item type. The mapping module:

1. Validates that the LLM-returned `itemType` is a valid Zotero item type.
2. Filters the returned fields to only those valid for the detected item type (using the schema's `itemTypeFields` mapping).
3. Maps any aliased field names (e.g., the LLM might return `"journal"` but Zotero expects `"publicationTitle"`).
4. Validates creator types against the item type's valid creator types.

**Key Zotero item types and their high-value fields:**

| Item Type | Key Fields |
|-----------|------------|
| `journalArticle` | title, publicationTitle, volume, issue, pages, date, DOI, ISSN, abstractNote |
| `book` | title, publisher, place, date, ISBN, numPages, edition, series |
| `bookSection` | title, bookTitle, publisher, place, pages, date, ISBN |
| `conferencePaper` | title, conferenceName, proceedingsTitle, place, date, DOI, pages |
| `thesis` | title, university, thesisType, date, numPages |
| `report` | title, institution, reportNumber, date, pages |
| `preprint` | title, repository, archiveID, date, DOI |
| `webpage` | title, websiteTitle, url, accessDate |

**Zotero JavaScript API for writing fields:**

```javascript
// Set simple fields
item.setField('title', 'Extracted Title');
item.setField('date', '2024-03-15');
item.setField('DOI', '10.1234/example');

// Set creators (replaces all existing creators)
item.setCreators([
  { creatorType: 'author', firstName: 'Jane', lastName: 'Smith' },
  { creatorType: 'editor', firstName: 'Bob', lastName: 'Jones' }
]);

// Change item type
item.setType(Zotero.ItemTypes.getID('journalArticle'));

// Persist to database
await item.saveTx();
```

### 5.5 Extraction Pipeline (`extractionPipeline.ts`)

**Responsibility:** Orchestrate the full extraction flow.

**Flow for a single item:**

```
1. Check item has PDF attachment
   └── No  → Skip, show warning
   └── Yes → Continue

2. Extract text from PDF
   └── No text → Check OCR preference
       └── OCR enabled → Run OCR, retry
       └── OCR disabled → Skip, show warning
   └── Has text → Continue

3. Check if item already has metadata
   └── Has metadata → Include existing fields in prompt as context
                       ("The following metadata exists. Verify or correct it.")
   └── Empty item → Standard extraction prompt

4. Call LLM with constructed prompt
   └── Parse JSON response
   └── Validate against Zotero schema
   └── Handle parse errors (retry once with repair prompt)

5. Optionally verify identifiers
   └── DOI found → Query CrossRef, compare title/authors
   └── ISBN found → Query OpenAlex/Google Books
   └── Mismatch → Flag in review UI

6. Present results in Review Dialog
   └── User accepts/edits/rejects fields
   └── Write accepted fields to Zotero item
```

**Batch processing:** When multiple items are selected, the pipeline processes them sequentially with a progress bar. Rate limiting is applied per the LLM provider's limits (e.g., Anthropic's per-minute token limits).

### 5.6 Review Dialog (`reviewDialog.ts` + `reviewDialog.xhtml`)

**Responsibility:** Present extracted metadata for user review before committing.

The dialog is a modal XHTML window opened via `Zotero.getMainWindow().openDialog()`. It displays:

- The detected item type (with a dropdown to override).
- A two-column table: "Field Name | Current Value | Extracted Value | Accept?"
- Each row has a checkbox (default: checked if the current value is empty, unchecked if a non-empty value would be overwritten).
- A confidence indicator (color-coded: green ≥ 0.8, yellow 0.5–0.8, red < 0.5).
- A "Verify DOI" button that cross-references against CrossRef in real-time.
- "Accept All," "Accept Empty Only," and "Cancel" action buttons.

For batch processing, the dialog cycles through items one at a time, with "Next" / "Previous" navigation and a "Accept All Remaining" shortcut.

### 5.7 Verification Service (`verification.ts`)

**Responsibility:** Cross-reference LLM-extracted identifiers against authoritative external APIs.

**CrossRef lookup (for DOIs):**

```
GET https://api.crossref.org/works/{doi}
```

Compare the returned title and first author against the LLM's extraction. If they match (fuzzy string comparison, > 80% similarity), mark the DOI as verified. If they diverge, flag it.

**OpenAlex lookup (for general verification):**

```
GET https://api.openalex.org/works?filter=doi:{doi}
```

Or search by title:

```
GET https://api.openalex.org/works?search={title}&per_page=1
```

This can also discover DOIs that the LLM missed — if the title search returns a strong match with a DOI, suggest it to the user.

**Google Books (for ISBNs):**

```
GET https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}
```

**Rate limiting:** CrossRef requests include a `mailto:` parameter in the User-Agent for polite pool access. OpenAlex is free and fast. All verification is optional and toggled in preferences.

---

## 6. User Interface Integration

### 6.1 Context Menu

Add a right-click context menu item on selected items:

```
"Extract Metadata with AI"
```

Visible when at least one selected item is a regular item (not a note or standalone attachment). Grayed out if no API key is configured, with a tooltip directing the user to preferences.

### 6.2 Toolbar Button

Add a toolbar button with the plugin icon that triggers extraction on the currently selected items. Tooltip: "Extract metadata from PDFs using AI".

### 6.3 Preferences Pane

Location: `Edit → Settings → LLM Metadata`

**Settings:**

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| LLM Provider | Dropdown | `anthropic` | anthropic, openai, openai-compatible |
| API Key | Password field | (empty) | Stored encrypted in Zotero preferences |
| Custom Endpoint | Text field | (empty) | For openai-compatible providers |
| Model | Text field | `claude-sonnet-4-20250514` | Model identifier string |
| Temperature | Slider | 0.0 | 0.0–1.0 |
| Auto-verify DOIs | Checkbox | true | Cross-reference against CrossRef |
| Auto-verify ISBNs | Checkbox | true | Cross-reference against Google Books |
| Overwrite existing fields | Dropdown | "Ask" | Never / Ask / Empty only / Always |
| Max pages to extract | Number | 5 | First N pages sent to LLM |
| Enable OCR fallback | Checkbox | false | Use Zotero OCR for image-only PDFs |

**Preference keys** (prefixed per convention):

```
extensions.zotero.llm-metadata.provider
extensions.zotero.llm-metadata.apiKey
extensions.zotero.llm-metadata.endpoint
extensions.zotero.llm-metadata.model
extensions.zotero.llm-metadata.temperature
extensions.zotero.llm-metadata.verifyDOI
extensions.zotero.llm-metadata.verifyISBN
extensions.zotero.llm-metadata.overwriteMode
extensions.zotero.llm-metadata.maxPages
extensions.zotero.llm-metadata.enableOCR
```

---

## 7. Privacy and Security Considerations

This plugin sends document text to an external API. This must be made transparent to the user.

- **First-run notice:** On first use, display a prominent dialog explaining that document text will be sent to the configured LLM provider's API. Require explicit acknowledgment.
- **API key storage:** Store the API key using Zotero's preference system. Note that Zotero preferences are stored in `prefs.js` in the profile directory — they are not encrypted at rest. The plugin should document this. A future enhancement could use the OS keychain via XPCOM.
- **Data minimization:** Send only the first N pages of text (default: 5), not the full document. This reduces exposure and cost.
- **No telemetry:** The plugin itself collects no data. The only network calls are to the user-configured LLM API and optional verification APIs.
- **Local LLM option:** Users who configure an `openai-compatible` provider pointing to `localhost` keep all data on their machine.

---

## 8. Error Handling

| Error | Behavior |
|-------|----------|
| No API key configured | Show a non-blocking notification linking to preferences. |
| No PDF attachment | Skip item, show warning in batch progress. |
| PDF has no extractable text | Show warning suggesting OCR. |
| LLM API returns non-JSON | Retry once with a "repair" prompt asking the LLM to fix its output. If still invalid, show error with raw response for debugging. |
| LLM API timeout (30s) | Retry once. If still failing, show network error. |
| LLM API rate limit (429) | Queue with exponential backoff (1s, 2s, 4s). Show "waiting for rate limit" in progress UI. |
| LLM API auth error (401/403) | Show error suggesting the user check their API key. |
| Invalid item type returned | Fall back to `document` (the most generic Zotero type). |
| CrossRef/OpenAlex verification fails | Proceed without verification; show a note in the review dialog. |

---

## 9. Performance and Cost

**Text extraction:** Near-instant via Zotero's pdf.js integration (text is typically already indexed).

**LLM API call latency:** 2–10 seconds per item depending on provider and document length.

**Token usage estimate per item:**

| Component | Tokens (approx.) |
|-----------|-------------------|
| System prompt | ~400 |
| Document text (3 pages) | ~1,500–3,000 |
| Response | ~300–600 |
| **Total** | **~2,200–4,000** |

**Cost per item (approximate, 2025 pricing):**

| Provider/Model | Input cost | Output cost | Total per item |
|----------------|------------|-------------|----------------|
| Claude Sonnet 4 | $3/M in | $15/M out | ~$0.01–0.02 |
| GPT-4o | $2.50/M in | $10/M out | ~$0.01 |
| Local (Ollama) | Free | Free | Free |

For batch processing of 100 items, expect $1–2 with a cloud provider.

---

## 10. Testing Strategy

### Unit Tests

- Prompt template generation for each item type.
- JSON response parsing with malformed inputs.
- Schema mapping for all 36+ Zotero item types.
- Field validation (e.g., rejecting a `volume` field on a `book` item type).

### Integration Tests

- End-to-end extraction from a sample PDF → LLM mock → Zotero item update.
- Verify CrossRef lookup returns expected results for known DOIs.
- Test the review dialog renders correctly with various field combinations.

### Manual Testing

- Test with diverse document types: journal articles, books, theses, reports, conference papers, preprints, non-English documents, scanned PDFs.
- Test with all three provider configurations.
- Test batch processing with 50+ items.

---

## 11. Prior Art and Differentiation

| Tool | Scope | Difference from this plugin |
|------|-------|-----------------------------|
| Zotero built-in metadata retrieval | DOI/ISBN lookup via CrossRef/Google Scholar | Only works with identifiers; fails on documents without them. |
| Zotero-format-metadata | Corrects/normalizes existing metadata | Doesn't extract from document content; requires existing metadata. |
| Aria (AI Research Assistant) | GPT-powered chat assistant inside Zotero | General-purpose Q&A; doesn't do targeted metadata extraction or field population. |
| Zotero-ZotaData | Multi-API metadata fetching via DOI/ISBN/title | API-based lookup, not document-content-based extraction. |

This plugin is unique in using the document's own text content as the primary source of metadata, filling the gap when identifiers are missing or external databases don't have a record.

---

## 12. Development Roadmap

### v0.1 — MVP

- Single-item extraction from PDF text.
- Anthropic Claude support only.
- Basic review dialog (accept all / cancel).
- Preferences pane with API key and model.

### v0.2 — Multi-Provider and Batch

- OpenAI and OpenAI-compatible provider support.
- Batch processing with progress bar.
- Per-field accept/reject in review dialog.
- CrossRef DOI verification.

### v0.3 — Enhanced Extraction

- Two-pass extraction (general → item-type-specific).
- Vision-based extraction for scanned PDFs (send page images to multimodal LLMs).
- OpenAlex and Google Books verification.
- "Suggest DOI" feature using title-based search.
- Confidence scoring with color indicators.

### v0.4 — Polish

- Localization (en-US, zh-CN, de, fr, es, pt-BR).
- Keyboard shortcuts.
- Extraction history/undo.
- Custom prompt template editor in preferences.
- Support for extracting metadata from EPUB and HTML attachments.

---

## 13. Build and Distribution

**Build toolchain:** Node.js + TypeScript + esbuild (via `zotero-plugin-scaffold`).

**Build commands:**

```bash
npm install
npm run build          # Production build → .scaffold/build/*.xpi
npm run start          # Dev mode with hot reload
```

**Distribution:** GitHub Releases with `.xpi` files. `update.json` manifest for Zotero's built-in auto-updater. Submit to the Zotero Plugin Directory once stable.

**CI/CD:** GitHub Actions workflow that builds and publishes on tagged commits.

---

## Appendix A: Complete Zotero Item Types

For reference, the full list of Zotero item types that the LLM must be able to classify documents into:

artwork, attachment, audioRecording, bill, blogPost, book, bookSection, case, computerProgram, conferencePaper, dictionaryEntry, document, email, encyclopediaArticle, film, forumPost, hearing, instantMessage, interview, journalArticle, letter, magazineArticle, manuscript, map, newspaperArticle, note, patent, podcast, preprint, presentation, radioBroadcast, report, standard, statute, thesis, tvBroadcast, videoRecording, webpage

The most commonly encountered types for PDF extraction are: journalArticle, book, bookSection, conferencePaper, thesis, report, preprint, and document (fallback).

## Appendix B: Key Zotero JavaScript APIs Used

```javascript
// Get selected items
ZoteroPane.getSelectedItems()

// Check item type
item.isRegularItem()
item.isAttachment()
item.isNote()

// Get/set fields
item.getField('title')
item.setField('title', 'New Title')

// Creators
item.getCreators()
item.setCreators([{ creatorType: 'author', firstName: 'A', lastName: 'B' }])

// Item type
item.setType(Zotero.ItemTypes.getID('journalArticle'))

// Attachments
item.getAttachments()  // returns array of attachment item IDs
let attachment = Zotero.Items.get(attachmentID)
attachment.attachmentContentType  // 'application/pdf'
await attachment.attachmentText   // full text of PDF

// Persist changes
await item.saveTx()

// Database transactions (for batch operations)
await Zotero.DB.executeTransaction(async function () {
  for (let id of ids) {
    let item = await Zotero.Items.getAsync(id);
    item.setField('fieldName', 'value');
    await item.save();
  }
});

// HTTP requests
await Zotero.HTTP.request('GET', url, { headers: {...} })
await Zotero.HTTP.request('POST', url, { body: JSON.stringify(data), headers: {...} })
```
