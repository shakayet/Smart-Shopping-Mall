import OpenAI from 'openai';
import config from '../config';

export const openaiClient = new OpenAI({ apiKey: config.openai.apiKey });

export type IAIListingAnalysis = {
  brand: string | null;
  category: string | null;
  condition: string | null;
  description: string | null;
  suggestedPrice: number | null;
  authenticityConfidence: number | null;
  attributes: Record<string, string>;
};

const ANALYSIS_PROMPT = `You are an expert luxury goods authenticator and reseller pricing assistant.
Analyze the provided product image and respond ONLY with a JSON object matching this shape:
{
  "brand": string | null,
  "category": string | null,
  "condition": "New" | "Excellent" | "Good" | "Fair" | "Poor" | null,
  "description": string | null,
  "suggestedPrice": number | null,
  "authenticityConfidence": number | null,
  "attributes": { [key: string]: string }
}
- "suggestedPrice" should be a realistic resale price estimate in AED.
- "authenticityConfidence" is a value between 0 and 100 representing how confident you are the item is genuine based on the image alone.
- "attributes" may include details such as material, color, size, hardware, etc. if identifiable.
- If you cannot determine a field, return null for it.
Do not include any text outside of the JSON object.`;

export const analyzeProductImage = async (
  imageUrl: string,
): Promise<IAIListingAnalysis> => {
  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: ANALYSIS_PROMPT },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(content);

  return {
    brand: parsed.brand ?? null,
    category: parsed.category ?? null,
    condition: parsed.condition ?? null,
    description: parsed.description ?? null,
    suggestedPrice: parsed.suggestedPrice ?? null,
    authenticityConfidence: parsed.authenticityConfidence ?? null,
    attributes: parsed.attributes ?? {},
  };
};
