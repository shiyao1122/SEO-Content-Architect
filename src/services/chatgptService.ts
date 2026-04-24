import OpenAI from "openai";

const getOpenAIClient = (apiKey?: string) => new OpenAI({
    apiKey: apiKey || process.env.OPENAI_API_KEY || "",
    dangerouslyAllowBrowser: true,
    baseURL: window.location.origin + "/openai"
});

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
 */
export async function researchMarketContext(seedKeyword: string, product: string, apiKey?: string, model: string = "gpt-5.4") {
    const client = getOpenAIClient(apiKey);
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

    const response = await (client as any).responses.create({
        model: model,
        input: prompt,
        text: {
            format: {
                type: "json_schema",
                name: "market_research",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        audience: { type: "string" },
                        persona: { type: "string" },
                        coreValues: { type: "string" }
                    },
                    required: ["audience", "persona", "coreValues"],
                    additionalProperties: false
                }
            }
        }
    });

    const resultText = response.output_text || response.text || (response.choices && response.choices[0]?.message?.content) || "";
    return parseJsonResponse(resultText);
}

/**
 * Node 1: Keyword Expansion
 */
export async function expandKeywords(seedKeyword: string, product: string, apiKey?: string, model: string = "gpt-5.4") {
    const client = getOpenAIClient(apiKey);
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

    const response = await (client as any).responses.create({
        model: model,
        input: prompt,
        text: {
            format: {
                type: "json_schema",
                name: "keyword_expansion",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        clusters: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    mainTitle: { type: "string" },
                                    intent: { type: "string" },
                                    keywords: { type: "array", items: { type: "string" } },
                                    whyDistinct: { type: "string" }
                                },
                                required: ["id", "mainTitle", "intent", "keywords", "whyDistinct"],
                                additionalProperties: false
                            }
                        }
                    },
                    required: ["clusters"],
                    additionalProperties: false
                }
            }
        }
    });

    const resultText = response.output_text || response.text || (response.choices && response.choices[0]?.message?.content) || "";
    const data = parseJsonResponse(resultText);
    return data.clusters;
}

/**
 * Node 2: Market & Competitor Research (Dissector)
 */
export async function researchCompetitors(topic: string, product: string, apiKey?: string, model: string = "gpt-5.4") {
    const client = getOpenAIClient(apiKey);
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

    const response = await (client as any).responses.create({
        model: model,
        input: prompt,
        tools: [{ type: "web_search" }] as any,
        text: {
            format: {
                type: "json_schema",
                name: "competitor_research",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        topInsights: { type: "string" },
                        competitorWeaknesses: { type: "array", items: { type: "string" } },
                        keyFacts: { type: "array", items: { type: "string" } },
                        userPainPoints: { type: "array", items: { type: "string" } }
                    },
                    required: ["topInsights", "competitorWeaknesses", "keyFacts", "userPainPoints"],
                    additionalProperties: false
                }
            }
        }
    });

    const resultText = response.output_text || response.text || (response.choices && response.choices[0]?.message?.content) || "";
    return parseJsonResponse(resultText);
}

/**
 * Node 3: Core Proposition + Node 4: GEO-Optimized Deep Outline
 */
export async function architectOutline(topic: string, research: any, product: string, apiKey?: string, model: string = "gpt-5.4") {
    const client = getOpenAIClient(apiKey);
    const prompt = `
    Generate a deep SEO/GEO outline for: "${topic}"
    Product: "${product}"
    Research Findings: ${JSON.stringify(research)}
    
    Requirements:
    1. Start with [GEO Summary]: A highly synthesized, bolded summary of the core answer to the user's intent.
    2. Define "Core Proposition": A unique angle that offers "Information Gain".
    3. Include EXACTLY 5-10 detailed sections in the "sections" array. Each section title must be descriptive.
    4. Include 20+ Semantic Keywords (LSI) in the "lsi" array.
    5. Define 3 anchor links to related articles (keywords provided above).
    
    Return JSON:
    {
      "title": "SEO Optimized Title",
      "coreProposition": "...",
      "sections": ["Section 1 Title", "Section 2 Title", ...],
      "lsi": ["Keyword 1", "Keyword 2", ...],
      "anchorLinks": [
        { "keyword": "Target Keyword", "url": "Placeholder URL" }
      ]
    }
  `;

    const response = await (client as any).responses.create({
        model: model,
        input: prompt,
        text: {
            format: {
                type: "json_schema",
                name: "outline_architecture",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        title: { type: "string" },
                        coreProposition: { type: "string" },
                        sections: { type: "array", items: { type: "string" } },
                        lsi: { type: "array", items: { type: "string" } },
                        anchorLinks: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    keyword: { type: "string" },
                                    url: { type: "string" }
                                },
                                required: ["keyword", "url"],
                                additionalProperties: false
                            }
                        }
                    },
                    required: ["title", "coreProposition", "sections", "lsi", "anchorLinks"],
                    additionalProperties: false
                }
            }
        }
    });

    const resultText = response.output_text || response.text || (response.choices && response.choices[0]?.message?.content) || "";
    return parseJsonResponse(resultText);
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
    apiKey?: string,
    model: string = "gpt-5.4"
) {
    const client = getOpenAIClient(apiKey);
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

    const response = await (client as any).responses.create({
        model: model,
        input: prompt,
        text: {
            format: {
                type: "json_schema",
                name: "write_segment",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        content: { type: "string" },
                        imageSuggestion: {
                            type: "object",
                            properties: {
                                suggestion: { type: "string" },
                                altText: { type: "string" }
                            },
                            required: ["suggestion", "altText"],
                            additionalProperties: false
                        }
                    },
                    required: ["content", "imageSuggestion"],
                    additionalProperties: false
                }
            }
        }
    });

    const resultText = response.output_text || response.text || (response.choices && response.choices[0]?.message?.content) || "";
    return parseJsonResponse(resultText);
}

/**
 * Node 6: Polish & AIO Connector
 */
export async function polishAndAIO(content: string, anchorLinks: { keyword: string; url: string }[], apiKey?: string, model: string = "gpt-5.4") {
    const client = getOpenAIClient(apiKey);
    const prompt = `
    You are an Editor & AIO (AI Optimization) Specialist.
    Original Content to Polish:
    ${content}
    
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

    const response = await (client as any).responses.create({
        model: model,
        input: prompt,
        text: {
            format: {
                type: "json_schema",
                name: "polish_content",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        polishedContent: { type: "string" },
                        tldr: { type: "string" },
                        metaTitle: { type: "string" },
                        metaDescription: { type: "string" }
                    },
                    required: ["polishedContent", "tldr", "metaTitle", "metaDescription"],
                    additionalProperties: false
                }
            }
        }
    });

    const resultText = response.output_text || response.text || (response.choices && response.choices[0]?.message?.content) || "";
    return parseJsonResponse(resultText);
}

/**
 * Node 7: QA Node (Micro-Surgery)
 */
export async function qaReview(content: string, sectionTitle: string, apiKey?: string, model: string = "gpt-5.4") {
    const client = getOpenAIClient(apiKey);
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

    const response = await (client as any).responses.create({
        model: model,
        input: prompt,
        text: {
            format: {
                type: "json_schema",
                name: "qa_review",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        pass: { type: "boolean" },
                        score: { type: "number" },
                        feedback: { type: "string" }
                    },
                    required: ["pass", "score", "feedback"],
                    additionalProperties: false
                }
            }
        }
    });

    const resultText = response.output_text || response.text || (response.choices && response.choices[0]?.message?.content) || "";
    return parseJsonResponse(resultText);
}

/**
 * Node 7b: Editor Micro-Surgery
 */
export async function editorMicrosurgery(content: string, feedback: string, apiKey?: string, model: string = "gpt-5.4") {
    const client = getOpenAIClient(apiKey);
    const prompt = `
    You are an Editor performing "Micro-Surgery". 
    Feedback from QA: ${feedback}
    Original Content:
    ${content}
    
    Task: Modify ONLY the problematic parts mentioned in the feedback. Maintain all other wording. 
    Inject missing data points if requested.
  `;

    const response = await (client as any).responses.create({
        model: model,
        input: prompt
    });

    const resultText = response.output_text || response.text || (response.choices && response.choices[0]?.message?.content) || "";
    return resultText;
}
