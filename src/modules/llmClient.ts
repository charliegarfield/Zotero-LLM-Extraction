/**
 * LLM Client — provider-agnostic HTTP client for LLM API calls.
 *
 * Supports Anthropic (Claude), OpenAI, and OpenAI-compatible endpoints.
 */

declare const Zotero: any;

export interface LLMConfig {
  provider: "anthropic" | "openai" | "openai-compatible";
  apiKey: string;
  endpoint?: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface LLMResponse {
  metadata: Record<string, any>;
  confidence: number;
  rawResponse: string;
}

const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff
const REQUEST_TIMEOUT = 30000; // 30 seconds
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503];

/**
 * Call the configured LLM API and return parsed metadata.
 */
export async function callLLM(
  config: LLMConfig,
  prompt: string,
  systemPrompt: string
): Promise<LLMResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const rawResponse = await makeRequest(config, prompt, systemPrompt);
      const parsed = parseResponse(rawResponse);
      return {
        metadata: parsed,
        confidence: parsed.confidence ?? 0.5,
        rawResponse,
      };
    } catch (error: any) {
      lastError = error;

      // Don't retry auth errors
      if (error.statusCode === 401 || error.statusCode === 403) {
        throw new LLMError(
          "Authentication failed. Please check your API key.",
          error.statusCode
        );
      }

      // Retry on transient errors
      if (
        attempt < RETRY_DELAYS.length &&
        (RETRYABLE_STATUS_CODES.includes(error.statusCode) ||
          error.message?.includes("timeout"))
      ) {
        Zotero.debug(
          `[LLM Metadata] Retry attempt ${attempt + 1} after ${RETRY_DELAYS[attempt]}ms`
        );
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error("LLM request failed after retries");
}

/**
 * Make a single HTTP request to the LLM API.
 */
async function makeRequest(
  config: LLMConfig,
  prompt: string,
  systemPrompt: string
): Promise<string> {
  const { url, headers, body } = buildRequest(config, prompt, systemPrompt);

  try {
    const response = await Zotero.HTTP.request("POST", url, {
      headers,
      body: JSON.stringify(body),
      timeout: REQUEST_TIMEOUT,
      responseType: "json",
    });

    if (response.status >= 400) {
      const err = new LLMError(
        `LLM API returned status ${response.status}`,
        response.status
      );
      throw err;
    }

    return extractResponseText(config.provider, response.response);
  } catch (error: any) {
    if (error instanceof LLMError) throw error;

    // Handle timeout
    if (
      error.message?.includes("timeout") ||
      error.message?.includes("Timeout")
    ) {
      throw new LLMError("Request timed out", 0);
    }

    throw new LLMError(`Network error: ${error.message}`, 0);
  }
}

/**
 * Build the HTTP request parameters for the configured provider.
 */
function buildRequest(
  config: LLMConfig,
  prompt: string,
  systemPrompt: string
): { url: string; headers: Record<string, string>; body: any } {
  switch (config.provider) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: {
          model: config.model,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        },
      };

    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: {
          model: config.model,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        },
      };

    case "openai-compatible":
      return {
        url: config.endpoint || "http://localhost:11434/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: {
          model: config.model,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        },
      };

    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}

/**
 * Extract the text content from the provider-specific response format.
 */
function extractResponseText(provider: string, response: any): string {
  switch (provider) {
    case "anthropic":
      // Anthropic returns { content: [{ type: "text", text: "..." }] }
      if (response?.content?.[0]?.text) {
        return response.content[0].text;
      }
      throw new LLMError("Unexpected Anthropic response format", 0);

    case "openai":
    case "openai-compatible":
      // OpenAI returns { choices: [{ message: { content: "..." } }] }
      if (response?.choices?.[0]?.message?.content) {
        return response.choices[0].message.content;
      }
      throw new LLMError("Unexpected OpenAI response format", 0);

    default:
      throw new LLMError(`Unknown provider: ${provider}`, 0);
  }
}

/**
 * Parse the LLM response text into a JSON object.
 * Handles both raw JSON and JSON wrapped in markdown code fences.
 */
function parseResponse(text: string): Record<string, any> {
  let cleaned = text.trim();

  // Strip markdown code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to find JSON object in the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (_) {
        // Fall through to error
      }
    }
    throw new LLMError(
      `Failed to parse LLM response as JSON: ${(e as Error).message}`,
      0
    );
  }
}

/**
 * Call the LLM with a PDF document (base64) instead of text.
 * Used for scanned PDFs where text extraction fails.
 * Anthropic: sends as a document content block.
 * OpenAI: sends first page description as text (vision not yet supported here).
 */
export async function callLLMWithPDF(
  config: LLMConfig,
  pdfBase64: string,
  systemPrompt: string,
  userPrompt: string,
  pageImages?: string[]
): Promise<LLMResponse> {
  Zotero.debug("[LLM Metadata] callLLMWithPDF: provider=" + config.provider +
    " pdfSize=" + Math.round(pdfBase64.length / 1024) + "KB base64" +
    " pageImages=" + (pageImages ? pageImages.length : 0));

  let requestBody: any;
  let url: string;
  let headers: Record<string, string>;

  if (config.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "pdfs-2024-09-25",
    };
    requestBody = {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
    };
  } else if (config.provider === "openai") {
    // OpenAI supports inline PDF via the "file" content type
    url = "https://api.openai.com/v1/chat/completions";
    headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + config.apiKey,
    };
    requestBody = {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "file",
              file: {
                filename: "document.pdf",
                file_data: "data:application/pdf;base64," + pdfBase64,
              },
            },
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
    };
  } else if (config.provider === "openai-compatible") {
    // OpenAI-compatible endpoints (Ollama, LM Studio, etc.)
    // Try page images if available, otherwise fall back to PDF or text-only
    url = config.endpoint || "http://localhost:11434/v1/chat/completions";
    headers = {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: "Bearer " + config.apiKey } : {}),
    };

    const contentBlocks: any[] = [];

    if (pageImages && pageImages.length > 0) {
      // Send page images via OpenAI vision format
      Zotero.debug("[LLM Metadata] Sending " + pageImages.length + " page images to compatible endpoint");
      for (const img of pageImages) {
        contentBlocks.push({
          type: "image_url",
          image_url: {
            url: "data:image/png;base64," + img,
            detail: "high",
          },
        });
      }
    }

    contentBlocks.push({ type: "text", text: userPrompt });

    requestBody = {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: contentBlocks },
      ],
    };
  } else {
    throw new LLMError("Unsupported provider for PDF vision: " + config.provider, 0);
  }

  try {
    const response = await Zotero.HTTP.request("POST", url, {
      headers,
      body: JSON.stringify(requestBody),
      timeout: 60000, // Longer timeout for vision requests
      responseType: "json",
    });

    if (response.status >= 400) {
      throw new LLMError("LLM API returned status " + response.status, response.status);
    }

    const rawResponse = extractResponseText(config.provider, response.response);
    const parsed = parseResponse(rawResponse);
    return {
      metadata: parsed,
      confidence: parsed.confidence ?? 0.5,
      rawResponse,
    };
  } catch (error: any) {
    if (error instanceof LLMError) throw error;
    throw new LLMError("Vision request failed: " + error.message, 0);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LLMError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "LLMError";
    this.statusCode = statusCode;
  }
}
