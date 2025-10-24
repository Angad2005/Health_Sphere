import React, { useMemo, useRef, useState, useEffect } from 'react';
import { chatWithLlmApi, getChatHistory, fetchCheckins } from '../services/api';
import Button from './ui/Button';
import Textarea from './ui/Textarea';
import Spinner from './ui/Spinner';
import { formatDate } from '../utils/formatDate';
import { useAuth } from '../context/AuthContext';
import { useToast } from './ui/ToastProvider';

export default function ChatbotConsole({ compact = false }) {
  const { user } = useAuth();
  const { notify } = useToast();
  const storageKey = useMemo(() => `chat:${user?.uid || 'anon'}:messages`, [user?.uid]);
  const prefKey = useMemo(() => `chat:${user?.uid || 'anon'}:useCheckins`, [user?.uid]);
  const prefAllKey = useMemo(() => `chat:${user?.uid || 'anon'}:useAllCheckins`, [user?.uid]);
  const prefProfileKey = useMemo(() => `chat:${user?.uid || 'anon'}:useProfile`, [user?.uid]);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [controller, setController] = useState(null);
  const [expandedIds, setExpandedIds] = useState({});
  const [atBottom, setAtBottom] = useState(true);
  const listRef = useRef(null);
  const textareaRef = useRef(null);
  const presets = useMemo(() => ([
    'Summarize my last diagnosis',
    'What red flags should I watch?',
    'Explain this lab result in simple terms',
    'What are next steps for follow-up?'
  ]), []);
  const [useCheckins, setUseCheckins] = useState(true);
  const [useAllCheckins, setUseAllCheckins] = useState(false);
  const [useProfile, setUseProfile] = useState(false);

  useEffect(() => {
    // load history on mount and when user changes
    const loadData = async () => {
      try {
        if (user) {
          // Load from backend for authenticated users
          const history = await getChatHistory(user.uid);
          const msgs = [];
          for (const item of history) {
            msgs.push({
              role: 'user',
              content: item.message,
              createdAt: new Date(item.created_at).getTime() || Date.now()
            });
            msgs.push({
              role: 'assistant',
              content: item.response,
              confidence: item.confidence_score,
              suggested_actions: item.suggested_actions || [], // Assume API returns this or extract if needed
              createdAt: new Date(item.created_at).getTime() || Date.now()
            });
          }
          setMessages(msgs);
        } else {
          // Load from localStorage for anon
          const raw = localStorage.getItem(storageKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) setMessages(parsed);
            else setMessages([]);
          } else {
            setMessages([]);
          }
        }

        const rawPref = localStorage.getItem(prefKey);
        if (rawPref === 'true' || rawPref === 'false') setUseCheckins(rawPref === 'true');
        else setUseCheckins(true);
        const rawAll = localStorage.getItem(prefAllKey);
        if (rawAll === 'true' || rawAll === 'false') setUseAllCheckins(rawAll === 'true');
        else setUseAllCheckins(false);
        const rawProfile = localStorage.getItem(prefProfileKey);
        if (rawProfile === 'true' || rawProfile === 'false') setUseProfile(rawProfile === 'true');
        else setUseProfile(true);
      } catch (_) {
        setMessages([]);
      }
      // reset expanded states on user change
      setExpandedIds({});
    };
    loadData();
  }, [user?.uid, storageKey, prefKey, prefAllKey, prefProfileKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    // persist to localStorage only for anon users
    if (!user) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(messages));
      } catch (_) {}
    }
  }, [messages, storageKey, user]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      const threshold = 16;
      const isBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
      setAtBottom(isBottom);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(prefKey, String(useCheckins)); } catch (_) {}
  }, [useCheckins, prefKey]);
  useEffect(() => {
    try { localStorage.setItem(prefAllKey, String(useAllCheckins)); } catch (_) {}
  }, [useAllCheckins, prefAllKey]);
  useEffect(() => {
    try { localStorage.setItem(prefProfileKey, String(useProfile)); } catch (_) {}
  }, [useProfile, prefProfileKey]);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  async function send() {
    if (!canSend) return;
    if (!user && (useCheckins || useAllCheckins || useProfile)) {
      notify('Please sign in to use your profile or check-ins in chat.', 'info');
      return;
    }
    const nextMessages = [
      ...messages,
      { role: 'user', content: input, createdAt: Date.now() }
    ];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    try {
      // Fetch recent check-ins from backend API
      let clientCheckins = [];
      if (user && useCheckins) {
        try {
          clientCheckins = await fetchCheckins(useAllCheckins ? 365 : 7);
        } catch (_) {
          clientCheckins = [];
        }
      }
      const payload = {
        user_id: user?.uid,
        message: input,
        context: { conversation_history: messages },
        options: { useCheckins, checkinLimit: 7, useAllCheckins, checkinMax: 365, useProfile, clientCheckins }
      };
      const abort = new AbortController();
      setController(abort);
      const data = await chatWithLlmApi(payload, { signal: abort.signal });
      const reply = data?.response || data?.error || '...';
      const confidence = data?.confidence || null;
      const suggested_actions = data?.suggested_actions || [];
      setMessages(m => m.concat({ role: 'assistant', content: reply, confidence, suggested_actions, createdAt: Date.now() }));
    } catch (e) {
      console.error('chat error:', e);
      const message = e?.message || 'Network error';
      notify(message, 'error');
    } finally {
      setLoading(false);
      setController(null);
    }
  }

  function regenerateLast() {
    if (loading) return;
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIndex = i; break; }
    }
    if (lastUserIndex === -1) return;
    const base = messages.slice(0, lastUserIndex + 1);
    setMessages(base);
    const last = base[base.length - 1];
    setInput(last?.content || '');
    setTimeout(() => send(), 0);
  }

  function clearConversation() {
    setMessages([]);
  }

  useEffect(() => {
    const onClear = () => clearConversation();
    window.addEventListener('chat:clear', onClear);
    return () => window.removeEventListener('chat:clear', onClear);
  }, []);

  function copyMessage(content) {
    try {
      navigator.clipboard?.writeText(content);
    } catch (_) {}
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [input]);

  function renderMarkdownLite(text) {
    if (typeof text !== 'string' || text.length === 0) return null;
    const lines = text.split(/\r?\n/);

    function renderInline(t, keyPrefix) {
      const parts = [];
      let remaining = t;
      let key = 0;
      const boldRegex = /\*\*([^*]+)\*\*/;
      const italicRegex = /(^|[^*])\*([^*]+)\*(?!\*)/;
      while (remaining.length > 0) {
        const b = boldRegex.exec(remaining);
        const i = italicRegex.exec(remaining);
        let nextIndex = remaining.length;
        let type = null;
        let match = null;
        if (b && (i ? b.index <= i.index : true)) {
          nextIndex = b.index;
          type = 'bold';
          match = b;
        } else if (i) {
          nextIndex = i.index + (i[1] ? i[1].length : 0);
          type = 'italic';
          match = i;
        }
        if (!type) {
          parts.push(<span key={`${keyPrefix}-t-${key++}`}>{remaining}</span>);
          break;
        }
        if (nextIndex > 0) {
          parts.push(<span key={`${keyPrefix}-t-${key++}`}>{remaining.slice(0, nextIndex)}</span>);
        }
        if (type === 'bold') {
          parts.push(<strong key={`${keyPrefix}-b-${key++}`}>{match[1]}</strong>);
          remaining = remaining.slice(match.index + match[0].length);
        } else if (type === 'italic') {
          const leading = match[1] || '';
          if (leading) parts.push(<span key={`${keyPrefix}-l-${key++}`}>{leading}</span>);
          parts.push(<em key={`${keyPrefix}-i-${key++}`}>{match[2]}</em>);
          const consumed = (match.index + leading.length) + match[0].length - (leading ? 0 : 1);
          remaining = remaining.slice(consumed);
        }
      }
      return parts;
    }

    const blocks = [];
    let listBuffer = [];
    const flushList = () => {
      if (listBuffer.length > 0) {
        blocks.push(
          <ul key={`ul-${blocks.length}`} className="list-disc pl-5 my-2 space-y-1">
            {listBuffer.map((li, idx) => (
              <li key={`li-${idx}`}>{renderInline(li.replace(/^\s*[*-]\s+/, ''), `li-${idx}`)}</li>
            ))}
          </ul>
        );
        listBuffer = [];
      }
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (/^\s*[*-]\s+/.test(line)) {
        listBuffer.push(line);
        continue;
      }
      flushList();
      if (line.trim() === '') {
        blocks.push(<div key={`br-${idx}`} className="h-2" />);
      } else {
        blocks.push(<p key={`p-${idx}`}>{renderInline(line, `p-${idx}`)}</p>);
      }
    }
    flushList();
    return <div className="prose prose-sm dark:prose-invert max-w-none">{blocks}</div>;
  }

  return (
    <div className={`${compact ? 'flex h-full flex-col gap-0' : 'flex flex-col gap-3'}`}>
      {!compact && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Health AI · Local
            </span>
          </div>
          <div className="flex items-center gap-2">
            {loading ? (
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => controller?.abort()}>
                Stop
              </Button>
            ) : null}
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={clearConversation} disabled={messages.length === 0 && !loading}>Clear</Button>
          </div>
        </div>
      )}
      <div
        ref={listRef}
        className={`${compact ? 'flex-1 min-h-0 overflow-auto p-3' : 'max-h-[70vh] min-h-[55vh] overflow-auto p-4'} rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-slate-950/70 backdrop-blur shadow-inner`}
      >
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 bg-slate-50/60 dark:bg-slate-900/40">
            <div className="text-sm text-slate-600 dark:text-slate-300 mb-3">Start the conversation by asking a question, or try one of these:</div>
            <div className="flex flex-wrap gap-2">
              {presets.map((p, i) => (
                <button
                  key={i}
                  onClick={() => { setInput(p); setTimeout(() => send(), 0); }}
                  className="px-3 py-1.5 rounded-full text-xs bg-white hover:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-700 shadow-subtle"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex items-end gap-2 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`flex h-8 w-8 shrink-0 rounded-full items-center justify-center text-xs font-semibold ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-100'}`}>{m.role === 'user' ? 'You' : 'AI'}</div>
              <div>
                { (() => {
                  const id = `${m.createdAt || i}-${i}`;
                  const contentString = typeof m.content === 'string' ? m.content : '';
                  const lineCount = contentString ? contentString.split(/\r?\n/).length : 0;
                  const isLong = m.role === 'assistant' && (contentString.length > 300 || lineCount > 8);
                  const isExpanded = !!expandedIds[id];
                  return (
                    <div className={`group relative max-w-[95%] sm:max-w-[92%] md:max-w-[90%] lg:max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-subtle break-words whitespace-pre-wrap leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white rounded-br-md'
                    : 'bg-slate-100/90 dark:bg-slate-900/80 text-slate-900 dark:text-slate-100 rounded-bl-md border border-slate-200/60 dark:border-slate-800/60'
                }`}>
                      <div className={`${isLong && !isExpanded ? 'max-h-60 overflow-y-auto' : ''} pr-1 custom-scrollbar relative`}>
                        {m.role === 'assistant' ? (
                          <div className={`chat-content select-text ${isLong && !isExpanded ? 'line-clamp-10' : ''}`}>
                            {renderMarkdownLite(m.content)}
                          </div>
                        ) : (
                          <div className="break-words whitespace-pre-wrap">{m.content}</div>
                        )}
                        {m.role === 'assistant' && m.suggested_actions && m.suggested_actions.length > 0 && (
                          <div className="mt-2">
                            <strong>Suggested Actions:</strong>
                            <ul className="list-disc pl-5 space-y-1 text-sm">
                              {m.suggested_actions.map((action, idx) => (
                                <li key={idx}>{action}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {m.role === 'assistant' && m.confidence !== null && (
                          <span className="block mt-2 text-xs text-slate-500 dark:text-slate-400">
                            Confidence: {(m.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                        {isLong && !isExpanded ? (
                          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-100/90 dark:from-slate-900/80 to-transparent rounded-b-2xl" />
                        ) : null}
                      </div>
                      <div className={`absolute -top-3 ${m.role === 'user' ? '-left-3' : '-right-3'} hidden group-hover:flex items-center gap-1`}>
                        <button
                          onClick={() => copyMessage(m.content)}
                          title="Copy"
                          className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 shadow"
                        >
                          ⧉
                        </button>
                        {i === messages.length - 1 && m.role === 'assistant' ? (
                          <button
                            onClick={regenerateLast}
                            title="Regenerate"
                            className="inline-flex items-center justify-center h-6 px-2 rounded-full bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 shadow text-[10px]"
                          >
                            Regenerate
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })()}
                <div className={`mt-1 flex items-center gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`text-[10px] ${m.role === 'user' ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'}`}>
                    {m.createdAt ? formatDate(m.createdAt) : ''}
                  </div>
                  {(() => {
                    if (m.role !== 'assistant') return null;
                    const contentString = typeof m.content === 'string' ? m.content : '';
                    const lineCount = contentString ? contentString.split(/\r?\n/).length : 0;
                    const needsToggle = contentString.length > 300 || lineCount > 8;
                    if (!needsToggle) return null;
                    const id = `${m.createdAt || i}-${i}`;
                    const isExpanded = !!expandedIds[id];
                    return (
                      <button
                        className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-subtle"
                        onClick={() => setExpandedIds(s => ({ ...s, [id]: !s[id] }))}
                      >
                        {isExpanded ? 'Collapse' : 'Expand'}
                      </button>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="inline-flex items-center gap-2 text-slate-500 text-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-600"></span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.2s]"></span>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce"></span>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]"></span>
            </span>
          </div>
        )}
      </div>
      {!atBottom && (
        <div className="flex justify-end -mt-2">
          <button
            onClick={() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 shadow-subtle"
            title="Scroll to latest"
          >
            ↓ New
          </button>
        </div>
      )}
      <div className={`${compact ? 'sticky bottom-0 z-10 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur pt-3' : ''}`}>
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value.slice(0, 1000))}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Type your message"
            rows={compact ? 2 : 3}
          />
          <div className="flex flex-col items-end gap-1">
            <Button onClick={send} disabled={!canSend} className="shadow-subtle">
              Send
            </Button>
            <div className="text-[10px] text-slate-500">{input.length}/1000</div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                checked={useCheckins}
                onChange={e => setUseCheckins(e.target.checked)}
              />
              Use my daily check-ins for answers
            </label>
            <label className="inline-flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                checked={useProfile}
                onChange={e => setUseProfile(e.target.checked)}
              />
              Use my profile data
            </label>
            <label className="inline-flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                checked={useAllCheckins}
                onChange={e => setUseAllCheckins(e.target.checked)}
                disabled={!useCheckins}
              />
              Include all check-ins (compact)
            </label>
          </div>
          {compact ? (
            <div className="flex items-center gap-2">
              {loading ? (
                <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => controller?.abort()}>Stop</Button>
              ) : null}
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={clearConversation} disabled={messages.length === 0 && !loading}>Clear</Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}