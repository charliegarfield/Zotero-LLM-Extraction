# Zotero LLM Metadata Extractor

A Zotero 7 plugin that uses large language models to extract bibliographic metadata from PDF documents and fill in citation fields automatically.

When Zotero's built-in metadata retrieval fails — as it often does for preprints, working papers, dissertations, scanned documents, and foreign-language publications — this plugin sends the document text (or the PDF itself for scanned documents) to an LLM and writes the structured metadata back into Zotero.

## Features

- **Extract metadata from any PDF** — works with journal articles, books, theses, reports, conference papers, interviews, and more
- **Scanned PDF support** — sends page images directly to vision-capable LLMs (Claude) when no text layer exists
- **Multi-provider** — supports Anthropic (Claude), OpenAI, and OpenAI-compatible endpoints (Ollama, LM Studio, etc.)
- **Review before writing** — a dialog shows extracted fields side-by-side with current values; accept, edit, or reject each field
- **Auto-extract on import** — optionally extract metadata automatically when new PDFs are dragged into Zotero
- **Standalone PDF handling** — automatically creates parent items for standalone PDF attachments
- **DOI discovery** — searches OpenAlex by title to find DOIs the LLM missed
- **Identifier verification** — cross-references DOIs against CrossRef and ISBNs against Google Books
- **Batch processing** — select multiple items and extract metadata for all of them

## Installation

1. Download the latest `.xpi` from [Releases](../../releases)
2. In Zotero: Tools → Add-ons → gear icon → Install Add-on From File → select the `.xpi`

## Setup

1. Go to Edit → Settings → LLM Metadata
2. Select your LLM provider (Anthropic, OpenAI, or OpenAI-Compatible)
3. Enter your API key
4. Optionally adjust the model, temperature, and other settings

For local LLMs, select "OpenAI-Compatible" and set the endpoint (e.g., `http://localhost:11434/v1/chat/completions` for Ollama).

## Usage

### Manual extraction
- Select one or more items in your library
- Right-click → **Extract Metadata with AI**
- Review the extracted fields in the dialog and click **Apply Selected**

### Standalone PDFs
- Select a PDF that isn't attached to a parent item
- Click **Extract Metadata with AI** — a parent item is created automatically

### Auto-extract
- Enable "Auto-extract metadata when new items with PDFs are added" in settings
- Drag PDFs into Zotero — metadata is extracted and applied automatically

## Building from source

```bash
npm install
npm run build    # produces build/llm-metadata-extractor-0.1.0.xpi
```

Requires Node.js 18+.

## Privacy

- Document text is sent to the configured LLM provider's API for metadata extraction
- No data is collected or stored by this plugin beyond Zotero's normal storage
- API keys are stored in Zotero's preferences file (`prefs.js`) and are not encrypted at rest
- For maximum privacy, configure a local LLM endpoint
- A first-run privacy notice explains data handling and requires acknowledgment

## License

[MIT](LICENSE)
