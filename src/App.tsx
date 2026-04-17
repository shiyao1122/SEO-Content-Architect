import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Layout, 
  PenTool, 
  CheckCircle2, 
  Loader2, 
  ChevronRight, 
  FileText, 
  Target, 
  Users, 
  Zap, 
  AlertCircle,
  Copy,
  Download,
  RefreshCw,
  Network,
  BookOpen,
  Settings,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GenerationState, Article, ArticleSection } from './types';
import { 
  expandKeywords,
  researchCompetitors,
  architectOutline,
  writeSegment,
  polishAndAIO,
  qaReview,
  editorMicrosurgery,
  researchMarketContext
} from './services/geminiService';
import { withRetry, delay } from './lib/utils';

export default function App() {
  const [state, setState] = useState<GenerationState>({
    step: 'idle',
    seedKeyword: '',
    productToPromote: '',
    audience: '',
    persona: '',
    coreValues: '',
    articles: [],
    error: null,
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [customApiKey, setCustomApiKey] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedArticle = state.articles.find(a => a.id === selectedArticleId);

  const handleRetryFeedback = (attempt: number) => {
    setState(prev => ({ ...prev, error: `正在触发限流保护：尝试第 ${attempt} 次重连... (429 Rate Limit)` }));
  };


  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.seedKeyword) return;

    setIsGenerating(true);
    setState(prev => ({ ...prev, step: 'expanding', error: null, articles: [] }));

    try {
      // Node 0: Market Intelligence Research (Automated Context)
      const context = await withRetry(() => researchMarketContext(state.seedKeyword, state.productToPromote, customApiKey), handleRetryFeedback);
      setState(prev => ({
        ...prev,
        audience: context.audience,
        persona: context.persona,
        coreValues: context.coreValues
      }));

      // Node 1: Intent-Based Expansion
      const clusters = await withRetry(() => expandKeywords(state.seedKeyword, state.productToPromote, customApiKey), handleRetryFeedback);
      
      const initialArticles: Article[] = clusters.map((c: any) => ({
        id: c.id,
        title: c.mainTitle,
        intent: c.intent,
        keywords: c.keywords,
        researchData: '',
        competitiveResearch: { topInsights: '', competitorWeaknesses: [], keyFacts: [], userPainPoints: [] },
        coreProposition: '',
        outline: { title: '', sections: [], lsi: [], anchorLinks: [] },
        sections: [],
        finalContent: '',
        metaTitle: '',
        metaDescription: '',
        tldr: '',
        internalLinks: [],
        status: 'pending',
        qaPass: false
      }));

      setState(prev => ({ ...prev, articles: initialArticles }));
      setSelectedArticleId(initialArticles[0].id);

      // Process each article in the matrix
      for (let i = 0; i < initialArticles.length; i++) {
        if (i > 0) await delay(2000); // Sequential delay

        const artId = initialArticles[i].id;
        const artTitle = initialArticles[i].title;

        setState(prev => ({
          ...prev,
          articles: prev.articles.map(a => a.id === artId ? { ...a, status: 'processing' } : a)
        }));

        // Node 2: Competitor Research
        setState(prev => ({ ...prev, step: 'researching' }));
        const research = await withRetry(() => researchCompetitors(artTitle, state.productToPromote, customApiKey), handleRetryFeedback, 10);
        setState(prev => ({
          ...prev,
          articles: prev.articles.map(a => a.id === artId ? { ...a, researchData: research.topInsights, competitiveResearch: research } : a)
        }));

        // Node 4: Architecture (Includes Proposition)
        setState(prev => ({ ...prev, step: 'outlining' }));
        const outline = await withRetry(() => architectOutline(artTitle, research.topInsights, state.productToPromote, customApiKey), handleRetryFeedback, 10);
        setState(prev => ({
          ...prev,
          articles: prev.articles.map(a => a.id === artId ? { 
            ...a, 
            outline,
            coreProposition: outline.coreProposition,
            sections: outline.sections.map((s: string) => ({ title: s, content: '', isGenerating: false }))
          } : a)
        }));

        // Node 5: Segmented Writing
        setState(prev => ({ ...prev, step: 'writing' }));
        let accumulatedContent = `# ${outline.title}\n\n`;
        
        for (let j = 0; j < outline.sections.length; j++) {
          const sectionTitle = outline.sections[j];
          
          setState(prev => ({
            ...prev,
            articles: prev.articles.map(a => a.id === artId ? {
              ...a,
              sections: a.sections.map((s, idx) => idx === j ? { ...s, isGenerating: true } : s)
            } : a)
          }));

          let segmentRes = await withRetry(() => writeSegment(
            sectionTitle,
            outline.title,
            research.keyFacts,
            outline.coreProposition,
            accumulatedContent,
            context.persona, // Use automatically researched persona
            customApiKey
          ), handleRetryFeedback, 10);

          // Node 7: QA Node (Micro-Surgery Loop)
          setState(prev => ({ ...prev, step: 'qa' }));
          let qa = await withRetry(() => qaReview(segmentRes.content, sectionTitle, customApiKey), handleRetryFeedback);
          
          if (!qa.pass) {
            segmentRes.content = await withRetry(() => editorMicrosurgery(segmentRes.content, qa.feedback, customApiKey), handleRetryFeedback);
          }

          accumulatedContent += `## ${sectionTitle}\n\n${segmentRes.content}\n\n`;

          setState(prev => ({
            ...prev,
            articles: prev.articles.map(a => a.id === artId ? {
              ...a,
              sections: a.sections.map((s, idx) => idx === j ? { 
                ...s, 
                content: segmentRes.content, 
                isGenerating: false, 
                imageSuggestion: segmentRes.imageSuggestion,
                qaFeedback: qa.pass ? '' : qa.feedback
              } : s)
            } : a)
          }));
        }

        // Node 6: Polishing & AIO
        setState(prev => ({ ...prev, step: 'polishing' }));
        const polished = await withRetry(() => polishAndAIO(
          accumulatedContent, 
          outline.anchorLinks,
          customApiKey
        ), handleRetryFeedback, 10);

        setState(prev => ({
          ...prev,
          articles: prev.articles.map(a => a.id === artId ? {
            ...a,
            finalContent: polished.polishedContent,
            tldr: polished.tldr,
            metaTitle: polished.metaTitle,
            metaDescription: polished.metaDescription,
            status: 'completed',
            qaPass: true
          } : a)
        }));
      }

      setState(prev => ({ ...prev, step: 'completed' }));

    } catch (err) {
      console.error(err);
      setState(prev => ({ ...prev, error: 'Matrix generation failed. Check console for details.', step: 'idle' }));
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden text-text-main">
      {/* Header */}
      <header className="h-16 bg-card border-b border-border flex justify-between items-center px-8 shrink-0 shadow-sm z-20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
            <Network className="text-white w-5 h-5" />
          </div>
          <div className="font-bold text-lg tracking-tight">MARKET SEO FACTORY v4.0</div>
        </div>
        <div className="flex gap-6 text-[11px] font-bold uppercase tracking-widest text-text-sub">
          {['context', 'expanding', 'researching', 'planning', 'outlining', 'writing', 'polishing', 'qa'].map((s) => (
            <span key={s} className={state.step === s ? 'text-primary' : ''}>{s}</span>
          ))}
        </div>
      </header>

      <main className="flex-1 grid grid-cols-[320px_1fr_320px] gap-6 p-6 overflow-hidden">
        {/* Left Panel: Matrix Config */}
        <div className="panel">
          <div className="panel-header flex justify-between items-center">
            <span>矩阵规划 (Matrix Config)</span>
            <Settings className="w-3 h-3" />
          </div>
          <div className="content-area custom-scrollbar">
            <form onSubmit={handleStart} className="space-y-5">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-text-main uppercase tracking-wider">Gemini API Key</label>
                <input 
                  type="password" 
                  placeholder="粘贴您的 API Key"
                  className="input-field"
                  value={customApiKey}
                  onChange={e => setCustomApiKey(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-text-main uppercase tracking-wider">推广产品信息 (Core Feature)</label>
                <input 
                  type="text" 
                  placeholder="e.g. Kling AI - 高清视频生成器"
                  className="input-field"
                  value={state.productToPromote}
                  onChange={e => setState(prev => ({ ...prev, productToPromote: e.target.value }))}
                  disabled={isGenerating}
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-bold text-text-main uppercase tracking-wider">关键词列表</label>
                </div>
                <textarea 
                  placeholder="输入核心关键词（裂变集群）或列表（批量）"
                  className="input-field h-28 font-mono text-[11px] leading-relaxed resize-none p-3"
                  value={state.seedKeyword}
                  onChange={e => setState(prev => ({ ...prev, seedKeyword: e.target.value }))}
                  disabled={isGenerating}
                />
              </div>

              {/* Research Insights Visualizer (Auto-filled) */}
              {(state.audience || state.persona) && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="space-y-4 p-4 bg-gray-50 rounded-xl border border-border"
                >
                  <label className="block text-[10px] font-bold text-primary uppercase tracking-wider">Research Insights (Automated)</label>
                  <div className="space-y-2 text-[11px] leading-relaxed">
                    <div><span className="font-bold text-text-main">Target:</span> {state.audience}</div>
                    <div><span className="font-bold text-text-main">Persona:</span> {state.persona}</div>
                    <div className="text-text-sub italic">{state.coreValues}</div>
                  </div>
                </motion.div>
              )}

              {state.error && (
                <div className="p-3 bg-red-50 border border-red-100 text-red-600 rounded-lg text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{state.error}</span>
                </div>
              )}

              <button 
                type="submit"
                disabled={isGenerating || !state.seedKeyword}
                className="btn-primary w-full flex items-center justify-center gap-2 mt-4 shadow-lg shadow-primary/20"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    矩阵生成中...
                  </>
                ) : (
                  <>
                    <Network className="w-4 h-4" />
                    生成 1→5 互联矩阵
                  </>
                )}
              </button>
            </form>

            {/* Article List */}
            {state.articles.length > 0 && (
              <div className="mt-8 space-y-3">
                <label className="block text-xs font-bold text-text-main uppercase tracking-wider mb-2">矩阵内容列表</label>
                {state.articles.map((art) => (
                  <button
                    key={art.id}
                    onClick={() => setSelectedArticleId(art.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center gap-3 ${
                      selectedArticleId === art.id 
                        ? 'border-primary bg-blue-50/50 ring-1 ring-primary/10' 
                        : 'border-border bg-white hover:border-primary/30'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${
                      art.status === 'completed' ? 'bg-accent-success' : 
                      art.status === 'processing' ? 'bg-primary animate-pulse' : 'bg-gray-300'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-primary mb-0.5">{art.intent}</div>
                      <div className="text-xs font-semibold truncate">{art.title}</div>
                    </div>
                    <ArrowRight className={`w-3 h-3 ${selectedArticleId === art.id ? 'text-primary' : 'text-gray-300'}`} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Middle Panel: Article Editor */}
        <div className="panel">
          <div className="panel-header flex justify-between items-center">
            <span>内容编辑器 (Content Editor)</span>
            {selectedArticle && (
              <span className="text-[10px] bg-blue-50 text-primary px-2 py-0.5 rounded-full font-bold">
                {selectedArticle.status.toUpperCase()}
              </span>
            )}
          </div>
          <div className="content-area custom-scrollbar" ref={scrollRef}>
            {!selectedArticle ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4">
                  <BookOpen className="w-8 h-8 text-gray-300" />
                </div>
                <h3 className="text-base font-bold text-text-main mb-2">等待矩阵初始化</h3>
                <p className="text-xs text-text-sub max-w-[240px]">输入种子词并启动，系统将自动裂变并撰写 5 篇深度互联的文章。</p>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Progress View */}
                {selectedArticle.status !== 'completed' && (
                  <div className="space-y-4">
                    {selectedArticle.sections.map((section, idx) => (
                      <motion.div 
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`p-4 rounded-xl border transition-all ${
                          section.isGenerating ? 'border-primary bg-blue-50/30' : 'border-border bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-bold text-xs flex items-center gap-2">
                            {section.content ? <CheckCircle2 className="w-3.5 h-3.5 text-accent-success" /> : <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-200" />}
                            {section.title}
                          </h4>
                          {section.isGenerating && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
                        </div>
                        {section.content && (
                          <div className="mt-3 space-y-3">
                            <p className="text-[11px] text-text-sub leading-relaxed italic">
                              {section.content.substring(0, 150)}...
                            </p>
                            {section.imageSuggestion && (
                              <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100 flex items-start gap-3">
                                <Copy className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                                <div className="space-y-1">
                                  <div className="text-[10px] font-bold text-primary uppercase">🎨 Image Suggestion</div>
                                  <div className="text-[10px] text-text-main">{section.imageSuggestion.suggestion}</div>
                                  <div className="text-[9px] text-text-sub font-mono">Alt: {section.imageSuggestion.altText}</div>
                                </div>
                              </div>
                            )}
                            {section.qaFeedback && (
                              <div className="p-2 bg-red-50 text-[10px] text-red-600 rounded border border-red-100">
                                <strong>QA Feedback:</strong> {section.qaFeedback}
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </div>
                )}

                {/* Final Content View */}
                {selectedArticle.status === 'completed' && (
                  <div className="prose prose-sm max-w-none">
                    <div className="flex items-center justify-between mb-6 pb-4 border-b border-border">
                      <h2 className="text-lg font-bold m-0">{selectedArticle.title}</h2>
                      <div className="flex gap-2">
                        <button onClick={() => copyToClipboard(selectedArticle.finalContent)} className="p-2 hover:bg-gray-100 rounded-lg text-text-sub transition-colors"><Copy className="w-4 h-4" /></button>
                        <button className="p-2 hover:bg-gray-100 rounded-lg text-text-sub transition-colors"><Download className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="text-sm text-text-main leading-relaxed whitespace-pre-wrap font-sans">
                      {selectedArticle.finalContent}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Matrix Intelligence */}
        <div className="panel">
          <div className="panel-header">矩阵情报 (Matrix Intelligence)</div>
          <div className="content-area custom-scrollbar space-y-6">
            {selectedArticle ? (
              <>
                {/* GEO Quality Indicator */}
                <div className="p-4 bg-green-50 border border-green-100 rounded-xl relative overflow-hidden">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-bold text-green-700 uppercase tracking-widest">GEO Quality Score</span>
                    <span className="text-xs font-bold text-green-700">{selectedArticle.status === 'completed' ? '98%' : 'Analyzing...'}</span>
                  </div>
                  <div className="h-1 bg-green-200 rounded-full">
                    <motion.div 
                      className="h-full bg-green-600" 
                      initial={{ width: 0 }}
                      animate={{ width: selectedArticle.status === 'completed' ? '98%' : '40%' }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="text-[9px] bg-white/60 px-2 py-0.5 rounded text-green-800 font-bold border border-green-200">信息增量 (Info Gain)</span>
                    <span className="text-[9px] bg-white/60 px-2 py-0.5 rounded text-green-800 font-bold border border-green-200">数据注入 (Data Point)</span>
                    <span className="text-[9px] bg-white/60 px-2 py-0.5 rounded text-green-800 font-bold border border-green-200">前置总结 (GEO Summary)</span>
                  </div>
                </div>

                {/* TL;DR Summary */}
                {selectedArticle.tldr && (
                  <div className="p-4 bg-primary/5 border border-primary/10 rounded-xl">
                    <div className="flex items-center gap-2 mb-2 text-primary">
                      <Zap className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">AIO TL;DR Summary</span>
                    </div>
                    <p className="text-xs text-text-main font-medium leading-relaxed italic border-l-2 border-primary/30 pl-3">
                      {selectedArticle.tldr}
                    </p>
                  </div>
                )}

                {/* Competitive Research */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-bold text-text-main uppercase tracking-wider">Market & Competitor Intel</label>
                  </div>
                  <div className="space-y-2">
                    {selectedArticle.competitiveResearch.keyFacts.map((fact, i) => (
                      <div key={i} className="flex gap-2 p-2 bg-gray-50 rounded text-[10px] items-start">
                        <CheckCircle2 className="w-3 h-3 text-accent-success shrink-0" />
                        <span>{fact}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* LSI Keywords */}
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-text-main uppercase tracking-wider">语义词埋点 (LSI)</label>
                  <div className="flex flex-wrap gap-2">
                    {selectedArticle.outline.lsi.map((word, i) => (
                      <span key={i} className="knowledge-pill bg-white border-border">{word}</span>
                    ))}
                    {selectedArticle.outline.lsi.length === 0 && <span className="text-[11px] text-text-sub italic">等待架构师生成...</span>}
                  </div>
                </div>

                {/* Internal Links */}
                {selectedArticle.status === 'completed' && (
                  <div className="space-y-3 pt-4 border-t border-border">
                    <label className="block text-xs font-bold text-text-main uppercase tracking-wider">矩阵内链图谱 (Link Map)</label>
                    <div className="space-y-2">
                      {selectedArticle.internalLinks.map(linkId => {
                        const target = state.articles.find(a => a.id === linkId);
                        return (
                          <div key={linkId} className="flex items-center gap-2 text-[11px] text-primary font-medium">
                            <Network className="w-3 h-3" />
                            <span>Linked to: {target?.title}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Meta Data */}
                {selectedArticle.status === 'completed' && (
                  <div className="space-y-4 pt-4 border-t border-border">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-text-main uppercase tracking-wider">SEO Meta Title</label>
                      <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg text-xs font-bold text-primary">
                        {selectedArticle.metaTitle}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-text-main uppercase tracking-wider">SEO Meta Description</label>
                      <div className="p-3 bg-gray-50 border border-border rounded-lg text-[11px] text-text-sub leading-relaxed">
                        {selectedArticle.metaDescription}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                <Search className="w-10 h-10 text-gray-300 mb-2" />
                <p className="text-[10px] font-bold uppercase tracking-widest">Intelligence Offline</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E7EB;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #D1D5DB;
        }
      `}</style>
    </div>
  );
}
