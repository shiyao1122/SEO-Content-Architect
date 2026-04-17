import { GoogleGenAI, Type } from "@google/genai";

const getAiClient = (apiKey?: string) => new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || "" });

const PRO_MODEL = "gemini-3.1-pro-preview";
const FLASH_MODEL = "gemini-3-flash-preview";

/**
 * Utility to parse JSON from AI response, handling markdown blocks if present.
 */
function parseJsonResponse(text: string) {
  try {
    const cleaned = text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse JSON response:", text);
    throw new Error("Invalid JSON format from AI response");
  }
}

/**
 * Node 0: Market Context Researcher
 * Automatically generates Audience, Persona, and Selling Points based on Product + Keywords.
 */
export async function researchMarketContext(seedKeyword: string, product: string, apiKey?: string) {
  const ai = getAiClient(apiKey);
  const prompt = `
    You are a Strategic Market Analyst. 
    Product: "${product}"
    Seed Keyword: "${seedKeyword}"
    
    Task:
    1. Define the ideal Target Audience (be specific about their role and intent).
    2. Define a high-authority Writing Persona (e.g., "Senior Tech Architect at [Company]").
    3. Extract 3-5 Core Selling Points that differentiate our product in this keyword context.
    
    Return JSON:
    {
      "audience": "...",
      "persona": "...",
      "coreValues": "..."
    }
  `;

  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          audience: { type: Type.STRING },
          persona: { type: Type.STRING },
          coreValues: { type: Type.STRING }
        },
        required: ["audience", "persona", "coreValues"]
      }
    }
  });

  return parseJsonResponse(response.text);
}
export async function expandKeywords(seedKeyword: string, product: string, apiKey?: string) {
  const ai = getAiClient(apiKey);
  const prompt = `
    You are an SEO Strategist. 
    Seed Keyword: "${seedKeyword}"
    Product to Promote: "${product}"
    
    Task:
    1. Expand the seed keyword into a topic cluster.
    2. Group keywords by intent. Keywords with the same search intent (same search results) should be grouped together for ONE article.
    3. Identify related keywords with different intents. Each should be a SEPARATE article.
    4. Focus on high-value long-tail keywords for single articles.
    
    Output a JSON object with:
    {
      "clusters": [
        {
          "id": "art-1",
          "mainTitle": "Primary Headline",
          "intent": "Intent Category (e.g., Tutorial, Comparison)",
          "keywords": ["kw1", "kw2"],
          "whyDistinct": "Reason why this intent is unique"
        }
      ]
    }
  `;

  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          clusters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                mainTitle: { type: Type.STRING },
                intent: { type: Type.STRING },
                keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                whyDistinct: { type: Type.STRING }
              },
              required: ["id", "mainTitle", "intent", "keywords"]
            }
          }
        },
        required: ["clusters"]
      }
    }
  });

  const data = parseJsonResponse(response.text);
  return data.clusters;
}

/**
 * Node 2: Market & Competitor Research (Dissector)
 */
export async function researchCompetitors(topic: string, product: string, apiKey?: string) {
  const ai = getAiClient(apiKey);
  const prompt = `
    You are a Market Researcher & Competitive Dissector.
    Target Topic: "${topic}"
    Our Product: "${product}"
    
    Instructions:
    1. Scan Top 10 Google results for this topic (simulated).
    2. "Search for Competitor Reviews": Look for user complaints about existing solutions.
    3. Identify "Competitor Weak Points": Functions they claim but don't deliver, or outdated information (e.g., 2024 info vs 2026 reality).
    4. "3 Hidden Truths": What are 3 things only experts know that competitors are ignoring?
    5. Output a structured report.
    
    Return JSON:
    {
      "topInsights": "Synthesized view of the landscape",
      "competitorWeaknesses": ["Weakness 1", "Weakness 2"],
      "keyFacts": ["Fact with Data 1", "Fact with Data 2", "Real-world Case 1"],
      "userPainPoints": ["Pain Point 1", "Pain Point 2"]
    }
  `;

  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          topInsights: { type: Type.STRING },
          competitorWeaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
          keyFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
          userPainPoints: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["topInsights", "competitorWeaknesses", "keyFacts", "userPainPoints"]
      }
    } as any
  });

  const data = parseJsonResponse(response.text);
  return data;
}

/**
 * Node 3: Core Proposition + Node 4: GEO-Optimized Deep Outline
 */
export async function architectOutline(topic: string, research: any, product: string, apiKey?: string) {
  const ai = getAiClient(apiKey);
  const prompt = `
    Generate a deep SEO/GEO outline for: "${topic}"
    Product: "${product}"
    Research Findings: ${JSON.stringify(research)}
    
    Requirements:
    1. Start with [GEO Summary]: A highly synthesized, bolded summary of the core answer to the user's intent.
    2. Define "Core Proposition": A unique angle that offers "Information Gain".
    3. Identify LSI keywords and anchor link mappings (suggest 3 keywords to target for external link anchor text).
    4. Ensure logical flow for information gain.
    
    Return JSON:
    {
      "title": "SEO Optimized Title",
      "coreProposition": "...",
      "sections": ["Section 1 Title", "Section 2 Title"],
      "lsi": ["Keyword 1", "Keyword 2"],
      "anchorLinks": [
        { "keyword": "Target Keyword", "url": "Placeholder URL" }
      ]
    }
  `;

  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          coreProposition: { type: Type.STRING },
          sections: { type: Type.ARRAY, items: { type: Type.STRING } },
          lsi: { type: Type.ARRAY, items: { type: Type.STRING } },
          anchorLinks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                keyword: { type: Type.STRING },
                url: { type: Type.STRING }
              }
            }
          }
        },
        required: ["title", "coreProposition", "sections", "lsi", "anchorLinks"]
      }
    }
  });

  return parseJsonResponse(response.text);
}

/**
 * Node 5: Data-Rich Segmented Writer
 */
export async function writeSegment(
  sectionTitle: string,
  articleTitle: string,
  keyFacts: string[],
  proposition: string,
  previousContent: string,
  persona: string,
  apiKey?: string
) {
  const ai = getAiClient(apiKey);
  const prompt = `
    Write the section: "${sectionTitle}"
    Article: "${articleTitle}"
    Persona: ${persona}
    Core Proposition: ${proposition}
    
    MANDATORY DATA INJECTION:
    - You MUST use at least 2 data points or facts from this list: ${keyFacts.join(" | ")}
    - If comparing products, you MUST use a Markdown Table.
    - Provide 1 Image Suggestion for this section with SEO Alt-text.
    
    Content requirements:
    - Professional tone, deep technical detail, avoid AI fluff.
    - Consistency with Previous Context: ${previousContent.slice(-500)}
    
    Return JSON:
    {
      "content": "Markdown content here...",
      "imageSuggestion": {
        "suggestion": "Description of the image needed",
        "altText": "SEO Alt-text"
      }
    }
  `;

  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          content: { type: Type.STRING },
          imageSuggestion: {
            type: Type.OBJECT,
            properties: {
              suggestion: { type: Type.STRING },
              altText: { type: Type.STRING }
            }
          }
        },
        required: ["content", "imageSuggestion"]
      }
    }
  });

  return parseJsonResponse(response.text);
}

/**
 * Node 6: Polish & AIO Connector
 */
export async function polishAndAIO(content: string, anchorLinks: { keyword: string; url: string }[], apiKey?: string) {
  const ai = getAiClient(apiKey);
  const prompt = `
    You are an Editor & AIO (AI Optimization) Specialist.
    Task:
    1. Polish the content to remove "AI-isms" (e.g., 'In conclusion', 'Moreover').
    2. Create a [TL;DR Summary]: Max 150 words, using defining, concise sentences for AIO scraping.
    3. Auto-link: In the text, wrap the following keywords with their respective URLs:
       ${anchorLinks.map(l => `${l.keyword} -> ${l.url}`).join("\n")}
    
    Return JSON:
    {
      "polishedContent": "...",
      "tldr": "...",
      "metaTitle": "...",
      "metaDescription": "..."
    }
  `;

  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          polishedContent: { type: Type.STRING },
          tldr: { type: Type.STRING },
          metaTitle: { type: Type.STRING },
          metaDescription: { type: Type.STRING }
        },
        required: ["polishedContent", "tldr", "metaTitle", "metaDescription"]
      }
    }
  });

  return parseJsonResponse(response.text);
}

/**
 * Node 7: QA Node (Micro-Surgery)
 */
export async function qaReview(content: string, sectionTitle: string, apiKey?: string) {
  const ai = getAiClient(apiKey);
  const prompt = `
    You are a Content Auditor. 
    Review this section: "${sectionTitle}"
    Content:
    ${content}
    
    Checklist:
    - Does it contain at least 2 data points/key facts?
    - Is it free of AI fluff?
    - Is the tone professional and authoritative?
    
    Return JSON:
    {
      "pass": true/false,
      "score": 0-100,
      "feedback": "Specific feedback for improvement if Fail"
    }
  `;

  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          pass: { type: Type.BOOLEAN },
          score: { type: Type.NUMBER },
          feedback: { type: Type.STRING }
        },
        required: ["pass", "score", "feedback"]
      }
    }
  });

  return parseJsonResponse(response.text);
}

/**
 * Node 7b: Editor Micro-Surgery
 */
export async function editorMicrosurgery(content: string, feedback: string, apiKey?: string) {
  const ai = getAiClient(apiKey);
  const prompt = `
    You are an Editor performing "Micro-Surgery". 
    Feedback from QA: ${feedback}
    Original Content:
    ${content}
    
    Task: Modify ONLY the problematic parts mentioned in the feedback. Maintain all other wording. 
    Inject missing data points if requested.
  `;

  const response = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: prompt
  });

  return response.text;
}
