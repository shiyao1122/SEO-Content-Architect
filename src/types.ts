export type GenerationStep = 'idle' | 'expanding' | 'researching' | 'planning' | 'outlining' | 'writing' | 'polishing' | 'qa' | 'completed';

export interface ArticleSection {
  title: string;
  content: string;
  isGenerating: boolean;
  imageSuggestion?: { suggestion: string; altText: string };
  qaFeedback?: string;
}

export interface Article {
  id: string;
  title: string;
  intent: string;
  keywords: string[]; // Grouped same-intent keywords
  researchData: string;
  competitiveResearch: {
    topInsights: string;
    competitorWeaknesses: string[];
    keyFacts: string[];
    userPainPoints: string[];
  };
  coreProposition: string;
  outline: { title: string; coreProposition: string; sections: string[]; lsi: string[]; anchorLinks: { keyword: string; url: string }[] };
  sections: ArticleSection[];
  finalContent: string;
  metaTitle: string;
  metaDescription: string;
  tldr: string;
  internalLinks: string[];
  status: 'pending' | 'processing' | 'paused' | 'failed' | 'completed';
  qaPass: boolean;
}

export interface GenerationState {
  step: GenerationStep;
  seedKeyword: string;
  productToPromote: string; // New field
  audience: string;
  persona: string;
  coreValues: string;
  articles: Article[];
  error: string | null;
  selectedModel: string;
}
