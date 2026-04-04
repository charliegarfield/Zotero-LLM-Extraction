addon-name = LLM Metadata Extractor

# Context menu and toolbar
menu-extract-metadata = Extract Metadata with AI
menu-extract-metadata-tooltip = Extract metadata from PDFs using AI
menu-no-api-key = No API key configured — open Settings to add one

# Progress and status
progress-extracting = Extracting metadata...
progress-extracting-item = Extracting metadata from: { $title }
progress-batch = Processing { $current } of { $total }...
progress-waiting-rate-limit = Waiting for rate limit...
progress-verifying = Verifying identifiers...
progress-complete = Metadata extraction complete

# Errors
error-no-api-key = No API key configured. Go to Settings → LLM Metadata to add your API key.
error-no-pdf = No PDF attachment found for this item.
error-no-text = No text could be extracted from the PDF. Consider enabling OCR in settings.
error-llm-failed = LLM request failed: { $message }
error-llm-parse = Could not parse the LLM response. Raw output saved for debugging.
error-llm-auth = Authentication failed. Please check your API key in settings.
error-llm-timeout = Request timed out. Please try again.
error-network = Network error: { $message }

# Privacy
privacy-title = Privacy Notice
privacy-message = This plugin will send the text content of your PDF documents to the configured AI provider's API ({ $provider }) for metadata extraction. No data is stored by this plugin beyond what Zotero normally stores.
privacy-accept = I understand, continue
privacy-decline = Cancel

# Notifications
notify-fields-updated = Updated { $count } fields for "{ $title }"
notify-no-changes = No changes were applied.
notify-skipped = Skipped: { $reason }
