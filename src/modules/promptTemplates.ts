/**
 * Prompt Templates for LLM metadata extraction.
 *
 * These templates instruct the LLM to extract structured bibliographic
 * metadata from document text.
 */

export const SYSTEM_PROMPT = `You are a bibliographic metadata extraction engine. Given text extracted from a scholarly document, you produce structured citation metadata in JSON format compatible with the Zotero reference manager.

Rules:
- Only extract information explicitly present in the document text.
- Never fabricate DOIs, ISBNs, ISSNs, or other identifiers. If you cannot find one, set the field to null.
- If you are uncertain about a field, set it to null rather than guessing.
- For author names, preserve the exact form given in the document.
- Determine the most appropriate Zotero item type from this list: journalArticle, book, bookSection, conferencePaper, thesis, report, preprint, webpage, manuscript, document, artwork, audioRecording, bill, blogPost, case, computerProgram, dictionaryEntry, encyclopediaArticle, film, forumPost, hearing, interview, letter, magazineArticle, map, newspaperArticle, patent, podcast, presentation, radioBroadcast, standard, statute, tvBroadcast, videoRecording.
- Return ONLY valid JSON. No commentary, no markdown fences, no extra text.
- If the document is not in English, still extract metadata but set the "language" field to the appropriate ISO 639-1 code.

Interview-specific rules (itemType "interview"):
- The title should be the subject or topic of the interview, NOT "Interview with [Name]". If no clear topic, use a brief descriptive title based on the content.
- The person being interviewed (the "Interview With" field in Zotero) MUST use creatorType "interviewee" — this is Zotero's internal name for it.
- The person conducting/asking questions MUST use creatorType "interviewer".
- Do NOT use "author" or "contributor" for interview participants. ALWAYS use "interviewee" and "interviewer".
- The interviewee is the primary creator and should be listed first.
- Editors, compilers, or other people involved in producing the interview record should be listed as "contributor", NOT "editor".

Creator type rules (all item types):
- For interviews, use "interviewee" and "interviewer" as described above.
- For other item types, people who edited, compiled, or supervised the work should generally be listed as "contributor" unless they are specifically the editor of a book, journal, or collection. When in doubt, prefer "contributor" over "editor".

Place formatting:
- For locations in the United States, format as "City, ST" using the two-letter state abbreviation (e.g., "Davidson, NC" not "Davidson, North Carolina").
- For international locations, use "City, Country" format.`;

export const USER_PROMPT_TEMPLATE = `Extract bibliographic metadata from the following document text. Return a JSON object with this structure:

{
  "itemType": "<Zotero item type>",
  "title": "<string>",
  "creators": [
    {
      "creatorType": "author",
      "firstName": "<string>",
      "lastName": "<string>"
    }
  ],
  "date": "<date string, preferably ISO format like 2024-03-15>",
  "abstractNote": "<string or null>",
  "publicationTitle": "<journal or proceedings name, or null>",
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
  "tags": ["<keyword1>", "<keyword2>"],
  "confidence": <0.0-1.0 overall confidence>
}

--- DOCUMENT TEXT ---
{DOCUMENT_TEXT}`;

/**
 * Template for when existing metadata is present — asks the LLM to verify/correct.
 */
export const VERIFY_PROMPT_TEMPLATE = `The following document already has some metadata in Zotero. Review the document text and either verify or correct the existing metadata. Also fill in any missing fields.

Existing metadata:
{EXISTING_METADATA}

Return a complete JSON object with the same structure as below, including both verified existing fields and any new/corrected fields:

{
  "itemType": "<Zotero item type>",
  "title": "<string>",
  "creators": [
    {
      "creatorType": "author",
      "firstName": "<string>",
      "lastName": "<string>"
    }
  ],
  "date": "<date string, preferably ISO format>",
  "abstractNote": "<string or null>",
  "publicationTitle": "<journal or proceedings name, or null>",
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
  "tags": ["<keyword1>", "<keyword2>"],
  "confidence": <0.0-1.0 overall confidence>
}

--- DOCUMENT TEXT ---
{DOCUMENT_TEXT}`;

/**
 * Repair prompt — sent when the LLM's first response wasn't valid JSON.
 */
export const REPAIR_PROMPT = `Your previous response was not valid JSON. Please return ONLY a valid JSON object with the bibliographic metadata. No commentary, no markdown fences, no explanation — just the JSON object.

Your previous response was:
{PREVIOUS_RESPONSE}`;

/**
 * Build the user prompt for a fresh extraction.
 */
export function buildExtractionPrompt(documentText: string): string {
  return USER_PROMPT_TEMPLATE.replace("{DOCUMENT_TEXT}", documentText);
}

/**
 * Build the user prompt for verifying/correcting existing metadata.
 */
export function buildVerifyPrompt(
  documentText: string,
  existingMetadata: Record<string, any>
): string {
  const metadataStr = JSON.stringify(existingMetadata, null, 2);
  return VERIFY_PROMPT_TEMPLATE
    .replace("{EXISTING_METADATA}", metadataStr)
    .replace("{DOCUMENT_TEXT}", documentText);
}

/**
 * Build a repair prompt for a failed JSON parse.
 */
export function buildRepairPrompt(previousResponse: string): string {
  return REPAIR_PROMPT.replace("{PREVIOUS_RESPONSE}", previousResponse);
}
