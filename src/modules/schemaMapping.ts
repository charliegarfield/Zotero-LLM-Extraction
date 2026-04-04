/**
 * Schema Mapping — maps between LLM JSON output and Zotero's internal fields.
 *
 * Validates item types, filters fields by type, and handles aliased field names.
 */

declare const Zotero: any;

/**
 * All valid Zotero item types for regular items.
 */
export const VALID_ITEM_TYPES = [
  "artwork",
  "audioRecording",
  "bill",
  "blogPost",
  "book",
  "bookSection",
  "case",
  "computerProgram",
  "conferencePaper",
  "dictionaryEntry",
  "document",
  "email",
  "encyclopediaArticle",
  "film",
  "forumPost",
  "hearing",
  "instantMessage",
  "interview",
  "journalArticle",
  "letter",
  "magazineArticle",
  "manuscript",
  "map",
  "newspaperArticle",
  "patent",
  "podcast",
  "preprint",
  "presentation",
  "radioBroadcast",
  "report",
  "standard",
  "statute",
  "thesis",
  "tvBroadcast",
  "videoRecording",
  "webpage",
];

/**
 * Common field aliases the LLM might use → canonical Zotero field names.
 */
const FIELD_ALIASES: Record<string, string> = {
  journal: "publicationTitle",
  journalName: "publicationTitle",
  journalTitle: "publicationTitle",
  bookTitle: "publicationTitle",
  proceedingsTitle: "proceedingsTitle",
  conferenceName: "conferenceName",
  abstract: "abstractNote",
  year: "date",
  publicationDate: "date",
  doi: "DOI",
  isbn: "ISBN",
  issn: "ISSN",
  author: "creators",
  authors: "creators",
  editor: "creators",
  editors: "creators",
  keywords: "tags",
  keyword: "tags",
  location: "place",
  city: "place",
  publisherPlace: "place",
};

/**
 * Fields that are common across most item types.
 */
const UNIVERSAL_FIELDS = [
  "title",
  "date",
  "abstractNote",
  "language",
  "url",
  "accessDate",
  "rights",
  "extra",
  "shortTitle",
];

/**
 * Key fields per item type (in addition to universal fields).
 */
const ITEM_TYPE_FIELDS: Record<string, string[]> = {
  journalArticle: [
    "publicationTitle",
    "volume",
    "issue",
    "pages",
    "DOI",
    "ISSN",
    "journalAbbreviation",
    "series",
    "seriesTitle",
    "seriesText",
  ],
  book: [
    "publisher",
    "place",
    "ISBN",
    "numPages",
    "edition",
    "series",
    "seriesNumber",
    "volume",
    "numberOfVolumes",
  ],
  bookSection: [
    "bookTitle",
    "publisher",
    "place",
    "pages",
    "ISBN",
    "edition",
    "series",
    "seriesNumber",
    "volume",
    "numberOfVolumes",
  ],
  conferencePaper: [
    "conferenceName",
    "proceedingsTitle",
    "place",
    "pages",
    "DOI",
    "publisher",
    "volume",
    "series",
  ],
  thesis: ["university", "thesisType", "numPages", "place"],
  report: [
    "institution",
    "reportNumber",
    "reportType",
    "pages",
    "place",
    "seriesTitle",
  ],
  preprint: ["repository", "archiveID", "DOI", "series", "seriesTitle"],
  webpage: ["websiteTitle", "websiteType"],
  manuscript: ["manuscriptType", "place", "numPages"],
  document: ["publisher", "institution"],
  patent: [
    "assignee",
    "issuingAuthority",
    "patentNumber",
    "filingDate",
    "applicationNumber",
    "priorityNumbers",
    "issueDate",
    "country",
    "legalStatus",
  ],
  presentation: [
    "presentationType",
    "meetingName",
    "place",
  ],
  magazineArticle: ["publicationTitle", "volume", "issue", "pages", "ISSN"],
  newspaperArticle: [
    "publicationTitle",
    "place",
    "edition",
    "section",
    "pages",
    "ISSN",
  ],
  blogPost: ["blogTitle", "websiteType"],
  letter: ["letterType"],
  interview: ["interviewMedium"],
  film: ["distributor", "genre", "videoRecordingFormat", "runningTime"],
  artwork: ["artworkMedium", "artworkSize", "archive", "archiveLocation"],
};

/**
 * Valid creator types per item type.
 */
const CREATOR_TYPES: Record<string, string[]> = {
  journalArticle: [
    "author",
    "contributor",
    "editor",
    "reviewedAuthor",
    "translator",
  ],
  book: ["author", "contributor", "editor", "seriesEditor", "translator"],
  bookSection: [
    "author",
    "bookAuthor",
    "contributor",
    "editor",
    "seriesEditor",
    "translator",
  ],
  conferencePaper: [
    "author",
    "contributor",
    "editor",
    "seriesEditor",
    "translator",
  ],
  thesis: ["author", "contributor"],
  report: ["author", "contributor", "seriesEditor", "translator"],
  preprint: ["author", "contributor", "editor", "reviewedAuthor", "translator"],
  webpage: ["author", "contributor", "translator"],
  document: ["author", "contributor", "editor", "reviewedAuthor", "translator"],
};

/**
 * Default creator types — used when the item type isn't in the map above.
 */
const DEFAULT_CREATOR_TYPES = ["author", "contributor", "editor", "translator"];

export interface MappedMetadata {
  itemType: string;
  fields: Record<string, string>;
  creators: Array<{
    creatorType: string;
    firstName: string;
    lastName: string;
  }>;
  tags: string[];
  confidence: number;
}

/**
 * Map and validate the LLM output against Zotero's schema.
 */
export function mapToZoteroSchema(
  llmOutput: Record<string, any>
): MappedMetadata {
  // Validate item type
  let itemType = llmOutput.itemType || "document";
  if (!VALID_ITEM_TYPES.includes(itemType)) {
    Zotero.debug(
      `[LLM Metadata] Invalid item type "${itemType}", falling back to "document"`
    );
    itemType = "document";
  }

  // Get valid fields for this item type
  const validFields = new Set([
    ...UNIVERSAL_FIELDS,
    ...(ITEM_TYPE_FIELDS[itemType] || []),
  ]);

  // Map fields, resolving aliases
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(llmOutput)) {
    if (
      value === null ||
      value === undefined ||
      key === "itemType" ||
      key === "creators" ||
      key === "tags" ||
      key === "confidence"
    ) {
      continue;
    }

    // Resolve alias
    const canonicalKey = FIELD_ALIASES[key] || key;

    // Skip if it maps to creators/tags via alias
    if (canonicalKey === "creators" || canonicalKey === "tags") {
      continue;
    }

    if (validFields.has(canonicalKey)) {
      fields[canonicalKey] = String(value);
    }
  }

  // Map creators
  const validCreatorTypes = new Set(
    CREATOR_TYPES[itemType] || DEFAULT_CREATOR_TYPES
  );
  const creators = mapCreators(llmOutput.creators, validCreatorTypes);

  // Map tags
  const tags = mapTags(llmOutput.tags);

  return {
    itemType,
    fields,
    creators,
    tags,
    confidence: llmOutput.confidence ?? 0.5,
  };
}

/**
 * Map and validate creators array.
 */
function mapCreators(
  rawCreators: any,
  validTypes: Set<string>
): Array<{ creatorType: string; firstName: string; lastName: string }> {
  if (!Array.isArray(rawCreators)) return [];

  return rawCreators
    .filter((c: any) => c && (c.lastName || c.name))
    .map((c: any) => {
      let creatorType = c.creatorType || "author";
      if (!validTypes.has(creatorType)) {
        creatorType = "author";
      }

      // Handle single "name" field (split into first/last)
      if (c.name && !c.lastName) {
        const parts = c.name.trim().split(/\s+/);
        return {
          creatorType,
          firstName: parts.slice(0, -1).join(" "),
          lastName: parts[parts.length - 1],
        };
      }

      return {
        creatorType,
        firstName: c.firstName || "",
        lastName: c.lastName || "",
      };
    });
}

/**
 * Map tags — handles both string arrays and object arrays.
 */
function mapTags(rawTags: any): string[] {
  if (!Array.isArray(rawTags)) return [];

  return rawTags
    .map((t: any) => {
      if (typeof t === "string") return t.trim();
      if (t?.tag) return String(t.tag).trim();
      return "";
    })
    .filter((t: string) => t.length > 0);
}

/**
 * Get the valid fields for a given item type.
 */
export function getFieldsForItemType(itemType: string): string[] {
  return [
    ...UNIVERSAL_FIELDS,
    ...(ITEM_TYPE_FIELDS[itemType] || []),
  ];
}
