/**
 * Verification Service — cross-references extracted identifiers
 * against external APIs (CrossRef, OpenAlex, Google Books).
 */

declare const Zotero: any;

export interface VerificationResult {
  verified: boolean;
  source: string;
  matchScore: number; // 0-1
  message: string;
  suggestedDOI?: string;
  crossRefData?: Record<string, any>;
}

/**
 * Verify a DOI against CrossRef.
 */
export async function verifyDOI(
  doi: string,
  expectedTitle: string,
  expectedAuthor?: string
): Promise<VerificationResult> {
  try {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const response = await Zotero.HTTP.request("GET", url, {
      headers: {
        "User-Agent":
          "ZoteroLLMMetadata/0.1.0 (mailto:zotero-llm-metadata@example.com)",
        Accept: "application/json",
      },
      timeout: 10000,
      responseType: "json",
    });

    if (response.status !== 200) {
      return {
        verified: false,
        source: "CrossRef",
        matchScore: 0,
        message: `DOI not found in CrossRef (status ${response.status})`,
      };
    }

    const work = response.response?.message;
    if (!work) {
      return {
        verified: false,
        source: "CrossRef",
        matchScore: 0,
        message: "DOI not found in CrossRef",
      };
    }

    // Compare titles
    const crTitle = Array.isArray(work.title)
      ? work.title[0]
      : work.title || "";
    const titleScore = fuzzyMatch(expectedTitle, crTitle);

    // Compare first author if available
    let authorScore = 1.0;
    if (expectedAuthor && work.author?.length > 0) {
      const crAuthor = `${work.author[0].given || ""} ${work.author[0].family || ""}`.trim();
      authorScore = fuzzyMatch(expectedAuthor, crAuthor);
    }

    const overallScore = (titleScore * 0.7 + authorScore * 0.3);
    const verified = overallScore > 0.7;

    return {
      verified,
      source: "CrossRef",
      matchScore: overallScore,
      message: verified
        ? "DOI verified against CrossRef"
        : `DOI verification: title/author mismatch (score: ${(overallScore * 100).toFixed(0)}%)`,
      crossRefData: work,
    };
  } catch (error: any) {
    Zotero.debug(`[LLM Metadata] CrossRef verification error: ${error}`);
    return {
      verified: false,
      source: "CrossRef",
      matchScore: 0,
      message: `Verification failed: ${error.message}`,
    };
  }
}

/**
 * Search OpenAlex by title to discover a DOI.
 */
export async function searchOpenAlex(
  title: string
): Promise<VerificationResult> {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per_page=1`;
    const response = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ZoteroLLMMetadata/0.1.0",
      },
      timeout: 10000,
      responseType: "json",
    });

    if (response.status !== 200) {
      return {
        verified: false,
        source: "OpenAlex",
        matchScore: 0,
        message: "OpenAlex search failed",
      };
    }

    const results = response.response?.results;
    if (!results || results.length === 0) {
      return {
        verified: false,
        source: "OpenAlex",
        matchScore: 0,
        message: "No results found in OpenAlex",
      };
    }

    const topResult = results[0];
    const oaTitle = topResult.title || "";
    const matchScore = fuzzyMatch(title, oaTitle);

    if (matchScore > 0.8 && topResult.doi) {
      // Extract DOI from full URL
      const doi = topResult.doi.replace("https://doi.org/", "");
      return {
        verified: true,
        source: "OpenAlex",
        matchScore,
        message: `Found matching DOI via OpenAlex: ${doi}`,
        suggestedDOI: doi,
      };
    }

    return {
      verified: false,
      source: "OpenAlex",
      matchScore,
      message:
        matchScore > 0.5
          ? "Partial match found in OpenAlex but confidence too low"
          : "No matching work found in OpenAlex",
    };
  } catch (error: any) {
    Zotero.debug(`[LLM Metadata] OpenAlex search error: ${error}`);
    return {
      verified: false,
      source: "OpenAlex",
      matchScore: 0,
      message: `OpenAlex search failed: ${error.message}`,
    };
  }
}

/**
 * Verify an ISBN against Google Books.
 */
export async function verifyISBN(
  isbn: string,
  expectedTitle: string
): Promise<VerificationResult> {
  try {
    const cleanISBN = isbn.replace(/[-\s]/g, "");
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(cleanISBN)}`;
    const response = await Zotero.HTTP.request("GET", url, {
      headers: { Accept: "application/json" },
      timeout: 10000,
      responseType: "json",
    });

    if (response.status !== 200) {
      return {
        verified: false,
        source: "Google Books",
        matchScore: 0,
        message: "Google Books lookup failed",
      };
    }

    const data = response.response;
    if (!data.totalItems || data.totalItems === 0) {
      return {
        verified: false,
        source: "Google Books",
        matchScore: 0,
        message: "ISBN not found in Google Books",
      };
    }

    const book = data.items[0].volumeInfo;
    const gbTitle = book.title || "";
    const matchScore = fuzzyMatch(expectedTitle, gbTitle);
    const verified = matchScore > 0.7;

    return {
      verified,
      source: "Google Books",
      matchScore,
      message: verified
        ? "ISBN verified against Google Books"
        : `ISBN verification: title mismatch (score: ${(matchScore * 100).toFixed(0)}%)`,
    };
  } catch (error: any) {
    Zotero.debug(`[LLM Metadata] Google Books verification error: ${error}`);
    return {
      verified: false,
      source: "Google Books",
      matchScore: 0,
      message: `Google Books lookup failed: ${error.message}`,
    };
  }
}

/**
 * Simple fuzzy string matching (normalized Levenshtein similarity).
 * Returns a score from 0 (no match) to 1 (exact match).
 */
function fuzzyMatch(a: string, b: string): number {
  if (!a || !b) return 0;

  const normA = a.toLowerCase().trim();
  const normB = b.toLowerCase().trim();

  if (normA === normB) return 1;

  // Use bigram similarity for efficiency
  const bigramsA = getBigrams(normA);
  const bigramsB = getBigrams(normB);

  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let intersection = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.substring(i, i + 2));
  }
  return bigrams;
}
