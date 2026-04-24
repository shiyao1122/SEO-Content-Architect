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
  ArrowRight,
  Play,
  Pause,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GenerationState, Article, ArticleSection } from './types';
import * as geminiService from './services/geminiService';
import * as chatgptService from './services/chatgptService';
import { withRetry, delay } from './lib/utils';

export default function App() {
  const [state, setState] = useState<GenerationState>(() => {
    const saved = localStorage.getItem('seo_architect_state');
    const defaultState: GenerationState = {
      step: 'idle',
      seedKeyword: '',
      productToPromote: '',
      audience: '',
      persona: '',
      coreValues: '',
      articles: [],
      error: null,
      selectedModel: 'gemini-3.1-pro-preview'
    };
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...defaultState, ...parsed, articles: [], step: 'idle', error: null }; // Don't persist articles or active steps
      } catch (e) { return defaultState; }
    }
    return defaultState;
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [customApiKey, setCustomApiKey] = useState(() => localStorage.getItem('seo_architect_api_key') || '');
  const [aiProvider, setAiProvider] = useState<'gemini' | 'openai'>(() => (localStorage.getItem('seo_architect_provider') as any) || 'gemini');

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    // Only persist manual inputs: seedKeyword, productToPromote, selectedModel
    const toSave = {
      seedKeyword: state.seedKeyword,
      productToPromote: state.productToPromote,
      selectedModel: state.selectedModel
    };
    localStorage.setItem('seo_architect_state', JSON.stringify(toSave));
  }, [state.seedKeyword, state.productToPromote, state.selectedModel]);

  useEffect(() => {
    localStorage.setItem('seo_architect_api_key', customApiKey);
  }, [customApiKey]);

  useEffect(() => {
    localStorage.setItem('seo_architect_provider', aiProvider);
    // Only set default model if it wasn't loaded from storage or is currently empty
    if (!state.selectedModel) {
      const defaultModel = aiProvider === 'gemini' ? 'gemini-3.1-pro-preview' : 'gpt-5.4';
      setState(prev => ({ ...prev, selectedModel: defaultModel }));
    }
  }, [aiProvider]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedArticle = state.articles.find(a => a.id === selectedArticleId);

  const handleRetryFeedback = (attempt: number) => {
    setState(prev => ({ ...prev, error: `正在触发限流保护：尝试第 ${attempt} 次重连... (429 Rate Limit)` }));
  };

  const processArticle = async (artId: string, context: { audience: string, persona: string, coreValues: string, model: string }, apiKey?: string) => {
    const aiService = aiProvider === 'gemini' ? geminiService : chatgptService;
    const model = context.model;

    // Helper to check if processing should continue
    const shouldContinue = () => {
      const currentArt = stateRef.current.articles.find(a => a.id === artId);
      return currentArt?.status === 'processing';
    };

    try {
      const art = stateRef.current.articles.find(a => a.id === artId);
      if (!art) return;

      // Local tracker for consistency within the function
      let currentArtLocal: Article = { ...art, status: 'processing' };
      const artTitle = art.title;
      const product = stateRef.current.productToPromote;

      console.log(`[Processor] Starting article: ${artTitle} (ID: ${artId})`);

      // Node 2: Competitor Research
      if (!currentArtLocal.researchData) {
        console.log(`[Processor] Node 2: Researching competitors for ${artTitle}...`);
        setState(prev => ({ ...prev, step: 'researching' }));
        const research = await withRetry(() => aiService.researchCompetitors(artTitle, product, apiKey, model), handleRetryFeedback, 10);
        if (!shouldContinue()) return;

        currentArtLocal = {
          ...currentArtLocal,
          researchData: research.topInsights,
          competitiveResearch: research
        };

        setState(prev => ({
          ...prev,
          articles: prev.articles.map(a => a.id === artId ? currentArtLocal : a)
        }));
        console.log(`[Processor] Node 2 complete.`);
      }

      // Node 4: Architecture
      if (!currentArtLocal.outline.title) {
        console.log(`[Processor] Node 4: Planning architecture for ${artTitle}...`);
        setState(prev => ({ ...prev, step: 'outlining' }));
        const outline = await withRetry(async () => {
          const res = await aiService.architectOutline(artTitle, currentArtLocal.competitiveResearch, product, apiKey, model);
          if (!res.sections || res.sections.length === 0) throw new Error("架构师生成大纲失败：未返回章节列表");
          if (!res.lsi || res.lsi.length === 0) throw new Error("架构师生成LSI失败：未返回语义关键词");
          return res;
        }, handleRetryFeedback, 10);

        if (!shouldContinue()) return;

        currentArtLocal = {
          ...currentArtLocal,
          outline,
          coreProposition: outline.coreProposition,
          sections: outline.sections.map((s: string) => ({ title: s, content: '', isGenerating: false }))
        };

        setState(prev => ({
          ...prev,
          articles: prev.articles.map(a => a.id === artId ? currentArtLocal : a)
        }));
        console.log(`[Processor] Node 4 complete. LSI generated:`, outline.lsi);
      }

      // Node 5: Segmented Writing
      setState(prev => ({ ...prev, step: 'writing' }));
      let accumulatedContent = `# ${currentArtLocal.outline.title}\n\n`;

      for (let j = 0; j < currentArtLocal.outline.sections.length; j++) {
        if (!shouldContinue()) return;

        const sectionTitle = currentArtLocal.outline.sections[j];
        if (currentArtLocal.sections[j]?.content) {
          accumulatedContent += `## ${sectionTitle}\n\n${currentArtLocal.sections[j].content}\n\n`;
          continue;
        }

        setState(prev => ({
          ...prev,
          articles: prev.articles.map(a => a.id === artId ? {
            ...a,
            sections: a.sections.map((s, idx) => idx === j ? { ...s, isGenerating: true } : s)
          } : a)
        }));

        let segmentRes = await withRetry(() => aiService.writeSegment(
          sectionTitle,
          currentArtLocal.outline.title,
          currentArtLocal.competitiveResearch.keyFacts,
          currentArtLocal.outline.coreProposition,
          accumulatedContent,
          context.persona,
          apiKey,
          model
        ), handleRetryFeedback, 10);

        if (!shouldContinue()) return;

        // Node 7: QA Node
        setState(prev => ({ ...prev, step: 'qa' }));
        let qa = await withRetry(() => aiService.qaReview(segmentRes.content, sectionTitle, apiKey, model), handleRetryFeedback);

        if (!qa.pass) {
          segmentRes.content = await withRetry(() => aiService.editorMicrosurgery(segmentRes.content, qa.feedback, apiKey, model), handleRetryFeedback);
        }

        if (!shouldContinue()) return;

        accumulatedContent += `## ${sectionTitle}\n\n${segmentRes.content}\n\n`;

        currentArtLocal = {
          ...currentArtLocal,
          sections: currentArtLocal.sections.map((s, idx) => idx === j ? {
            ...s,
            content: segmentRes.content,
            isGenerating: false,
            imageSuggestion: segmentRes.imageSuggestion,
            qaFeedback: qa.pass ? '' : qa.feedback
          } : s)
        };

        setState(prev => ({
          ...prev,
          articles: prev.articles.map(a => a.id === artId ? currentArtLocal : a)
        }));
      }

      // Node 6: Polishing & AIO
      if (!shouldContinue()) return;
      setState(prev => ({ ...prev, step: 'polishing' }));
      const polished = await withRetry(() => aiService.polishAndAIO(
        accumulatedContent,
        currentArtLocal.outline.anchorLinks,
        apiKey,
        model
      ), handleRetryFeedback, 10);

      if (!shouldContinue()) return;

      currentArtLocal = {
        ...currentArtLocal,
        finalContent: polished.polishedContent,
        tldr: polished.tldr,
        metaTitle: polished.metaTitle,
        metaDescription: polished.metaDescription,
        status: 'completed',
        qaPass: true
      };

      setState(prev => ({
        ...prev,
        articles: prev.articles.map(a => a.id === artId ? currentArtLocal : a)
      }));

    } catch (err) {
      console.error(err);
      setState(prev => ({
        ...prev,
        articles: prev.articles.map(a => a.id === artId ? { ...a, status: 'failed' } : a)
      }));
    }
  };

  const startArticle = (artId: string) => {
    setState(prev => {
      const art = prev.articles.find(a => a.id === artId);
      if (art && (art.status === 'pending' || art.status === 'paused' || art.status === 'failed')) {
        const context = { audience: prev.audience, persona: prev.persona, coreValues: prev.coreValues, model: prev.selectedModel };
        processArticle(artId, context, customApiKey);
        return {
          ...prev,
          articles: prev.articles.map(a => a.id === artId ? { ...a, status: 'processing' } : a)
        };
      }
      return prev;
    });
  };

  const pauseArticle = (artId: string) => {
    setState(prev => ({
      ...prev,
      articles: prev.articles.map(a => a.id === artId ? { ...a, status: 'paused' } : a)
    }));
  };

  const deleteArticle = (artId: string) => {
    setState(prev => ({
      ...prev,
      articles: prev.articles.filter(a => a.id !== artId)
    }));
    if (selectedArticleId === artId) setSelectedArticleId(null);
  };

  const retryArticle = (artId: string) => {
    setState(prev => ({
      ...prev,
      articles: prev.articles.map(a => a.id === artId ? {
        ...a,
        researchData: '',
        competitiveResearch: { topInsights: '', competitorWeaknesses: [], keyFacts: [], userPainPoints: [] },
        coreProposition: '',
        outline: { title: '', coreProposition: '', sections: [], lsi: [], anchorLinks: [] },
        sections: [],
        finalContent: '',
        status: 'pending'
      } : a)
    }));
    setTimeout(() => startArticle(artId), 100);
  };


  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.seedKeyword) return;

    setIsGenerating(true);
    setState(prev => ({ ...prev, step: 'expanding', error: null, articles: [] }));

    const aiService = aiProvider === 'gemini' ? geminiService : chatgptService;

    try {
      // Node 0: Market Intelligence Research (Automated Context)
      const context = await withRetry(() => aiService.researchMarketContext(state.seedKeyword, state.productToPromote, customApiKey, state.selectedModel), handleRetryFeedback);
      setState(prev => ({
        ...prev,
        audience: context.audience,
        persona: context.persona,
        coreValues: context.coreValues
      }));

      // Node 1: Intent-Based Expansion
      const clusters = await withRetry(() => aiService.expandKeywords(state.seedKeyword, state.productToPromote, customApiKey, state.selectedModel), handleRetryFeedback);

      const initialArticles: Article[] = clusters.map((c: any) => ({
        id: c.id,
        title: c.mainTitle,
        intent: c.intent,
        keywords: c.keywords,
        researchData: '',
        competitiveResearch: { topInsights: '', competitorWeaknesses: [], keyFacts: [], userPainPoints: [] },
        coreProposition: '',
        outline: { title: '', coreProposition: '', sections: [], lsi: [], anchorLinks: [] },
        sections: [],
        finalContent: '',
        metaTitle: '',
        metaDescription: '',
        tldr: '',
        internalLinks: [],
        status: 'pending',
        qaPass: false
      }));

      setState(prev => ({ ...prev, articles: initialArticles, step: 'idle' }));
      setSelectedArticleId(initialArticles[0].id);

    } catch (err) {
      console.error(err);
      setState(prev => ({ ...prev, error: 'Matrix generation failed. Check console for details.', step: 'idle' }));
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('已复制到剪贴板 (Content Copied!)');
  };

  const downloadArticle = (article: Article) => {
    // Fallback to sections if finalContent is missing
    const content = article.finalContent || article.sections.map(s => `## ${s.title}\n\n${s.content}`).join('\n\n');

    const element = document.createElement("a");
    const file = new Blob([content], { type: 'text/markdown' });
    element.href = URL.createObjectURL(file);

    // Sanitize filename: keep alphanumeric, spaces, and Unicode (e.g. Chinese characters)
    let safeTitle = article.title.replace(/[<>:"/\\|?*]/g, '').trim();
    if (!safeTitle) safeTitle = `article-${article.id.substring(0, 8)}`;

    element.download = `${safeTitle}.md`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
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
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-bold text-text-main uppercase tracking-wider">AI Provider</label>
                </div>
                <div className="flex bg-gray-50 p-1 rounded-lg mb-4">
                  <button
                    type="button"
                    onClick={() => setAiProvider('gemini')}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all ${aiProvider === 'gemini' ? 'bg-white shadow-sm text-primary' : 'text-text-sub hover:text-text-main'}`}
                  >
                    Gemini
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiProvider('openai')}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all ${aiProvider === 'openai' ? 'bg-white shadow-sm text-primary' : 'text-text-sub hover:text-text-main'}`}
                  >
                    OpenAI (Responses API)
                  </button>
                </div>

                <div className="space-y-2 mb-6">
                  <label className="block text-[10px] font-bold text-text-sub uppercase tracking-widest">Select Model</label>
                  <select
                    value={state.selectedModel}
                    onChange={(e) => setState(prev => ({ ...prev, selectedModel: e.target.value }))}
                    className="w-full bg-white border border-border rounded-lg px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  >
                    {aiProvider === 'gemini' ? (
                      <>
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite (Preview)</option>
                        <option value="gemini-3-flash-preview">Gemini 3 Flash (Preview)</option>
                        <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Preview)</option>
                      </>
                    ) : (
                      <>
                        <option value="gpt-5.4">GPT-5.4</option>
                        <option value="gpt-5.4-mini">GPT-5.4 Mini</option>
                        <option value="gpt-5.4-nano">GPT-5.4 Nano</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-text-main uppercase tracking-wider">{aiProvider === 'gemini' ? 'Gemini API Key' : 'OpenAI API Key'}</label>
                <input
                  type="password"
                  placeholder={`Paste your ${aiProvider} API Key`}
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
                  <div
                    key={art.id}
                    onClick={() => setSelectedArticleId(art.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center gap-3 cursor-pointer select-none ${selectedArticleId === art.id
                      ? 'border-primary bg-blue-50/50 ring-1 ring-primary/10'
                      : 'border-border bg-white hover:border-primary/30'
                      }`}
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${art.status === 'completed' ? 'bg-accent-success' :
                      art.status === 'processing' ? 'bg-primary animate-pulse' :
                        art.status === 'paused' ? 'bg-yellow-400' :
                          art.status === 'failed' ? 'bg-red-500' : 'bg-gray-300'
                      }`} />
                    <div className="flex-1 min-w-0" onClick={() => setSelectedArticleId(art.id)}>
                      <div className="text-[11px] font-bold text-primary mb-0.5">{art.intent}</div>
                      <div className="text-[11px] font-semibold leading-tight">{art.title}</div>
                    </div>

                    <div className="flex gap-1 shrink-0">
                      {(art.status === 'pending' || art.status === 'paused' || art.status === 'failed') && (
                        <button
                          onClick={(e) => { e.stopPropagation(); startArticle(art.id); }}
                          className="p-1 hover:bg-primary/10 rounded text-primary transition-colors"
                          title="开始生成"
                        >
                          <Play className="w-3 h-3" />
                        </button>
                      )}
                      {art.status === 'processing' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); pauseArticle(art.id); }}
                          className="p-1 hover:bg-yellow-100 rounded text-yellow-600 transition-colors"
                          title="暂停生成"
                        >
                          <Pause className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); retryArticle(art.id); }}
                        className="p-1 hover:bg-gray-100 rounded text-gray-500 transition-colors"
                        title="重试任务"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteArticle(art.id); }}
                        className="p-1 hover:bg-red-100 rounded text-red-500 transition-colors"
                        title="删除任务"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    <ArrowRight className={`w-3 h-3 shrink-0 ${selectedArticleId === art.id ? 'text-primary' : 'text-gray-300'}`} />
                  </div>
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
                    {selectedArticle.sections.length === 0 && selectedArticle.status === 'processing' && (
                      <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                        <div className="relative">
                          <Loader2 className="w-10 h-10 text-primary animate-spin" />
                          <Search className="w-4 h-4 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-text-main">
                            {state.step === 'researching' ? '正在进行深度市场调研...' : '正在规划内容架构...'}
                          </h4>
                          <p className="text-[10px] text-text-sub mt-1">正在为您的文章注入实时数据和竞争对手洞察</p>
                        </div>
                        <div className="w-48 h-1 bg-gray-100 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-primary"
                            initial={{ x: '-100%' }}
                            animate={{ x: '100%' }}
                            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                          />
                        </div>
                      </div>
                    )}
                    {selectedArticle.sections.map((section, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`p-4 rounded-xl border transition-all ${section.isGenerating ? 'border-primary bg-blue-50/30' : 'border-border bg-white'
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
                        <button
                          onClick={() => copyToClipboard(selectedArticle.finalContent)}
                          className="p-2 hover:bg-gray-100 rounded-lg text-text-sub transition-colors"
                          title="复制全文"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => downloadArticle(selectedArticle)}
                          className="p-2 hover:bg-gray-100 rounded-lg text-text-sub transition-colors"
                          title="下载为 Markdown"
                        >
                          <Download className="w-4 h-4" />
                        </button>
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
