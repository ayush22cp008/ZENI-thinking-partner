import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Dual Mode API Config ──────────────────────────────────────────────────────
// VITE_MODE=private  →  local Ollama (default, fully private)
// VITE_MODE=demo     →  Groq cloud (for Vercel / portfolio demo)
const IS_DEMO = import.meta.env.VITE_MODE === 'demo'

const API_CONFIG = IS_DEMO
  ? {
      chatUrl:     '/api/groq',
      generateUrl: '/api/groq',
      model:       'llama-3.1-8b-instant',
      headers:     { 'Content-Type': 'application/json' },
    }
  : {
      chatUrl:     '/ollama/api/chat',
      generateUrl: '/ollama/api/generate',
      model:       'llama3.2',
      headers:     { 'Content-Type': 'application/json' },
    }

async function callLLM(prompt, signal) {
  if (IS_DEMO) {
    // Groq — OpenAI-compatible format
    const res = await fetch(API_CONFIG.generateUrl, {
      method: 'POST',
      headers: API_CONFIG.headers,
      body: JSON.stringify({
        model: API_CONFIG.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
      signal,
    })
    if (!res.ok) {
      let msg = ''
      try {
        const rawText = await res.text()
        try {
          const errJson = JSON.parse(rawText)
          msg = errJson?.error?.message || rawText
        } catch {
          msg = rawText
        }
      } catch {
        msg = res.statusText || 'Unknown error'
      }
      throw new Error(`Groq error ${res.status}: ${msg}`)
    }
    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() || ''
  } else {
    // Ollama — native generate format
    const res = await fetch(API_CONFIG.generateUrl, {
      method: 'POST',
      headers: API_CONFIG.headers,
      body: JSON.stringify({ model: API_CONFIG.model, prompt, stream: false }),
      signal,
    })
    if (!res.ok) {
      let msg = ''
      try {
        const rawText = await res.text()
        try {
          const errJson = JSON.parse(rawText)
          msg = errJson?.error || rawText
        } catch {
          msg = rawText
        }
      } catch {
        msg = res.statusText || 'Unknown error'
      }
      throw new Error(`Ollama error ${res.status}: ${msg}`)
    }
    const data = await res.json()
    return data.response?.trim() || ''
  }
}

/**
 * Streaming LLM chat call.
 * `history` is the messages array. `onChunk(text)` called on each token.
 * Returns the full accumulated string when stream ends.
 */
async function streamLLM(systemPrompt, history, signal, onChunk) {
  if (IS_DEMO) {
    // Groq — OpenAI SSE streaming
    const res = await fetch(API_CONFIG.chatUrl, {
      method: 'POST',
      headers: API_CONFIG.headers,
      body: JSON.stringify({
        model: API_CONFIG.model,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
        ],
      }),
      signal,
    })
    if (!res.ok) {
      let msg = ''
      try {
        const rawText = await res.text()
        try {
          const errJson = JSON.parse(rawText)
          msg = errJson?.error?.message || rawText
        } catch {
          msg = rawText
        }
      } catch {
        msg = res.statusText || 'Unknown error'
      }
      throw new Error(`Groq error ${res.status}: ${msg}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let full = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      // SSE format: each line starts with "data: " — split and parse
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6))
            const token = json.choices?.[0]?.delta?.content || ''
            if (token) { full += token; onChunk(full) }
          } catch { /* partial chunk — skip */ }
        }
      }
    }
    return full

  } else {
    // Ollama — NDJSON streaming
    const res = await fetch(API_CONFIG.chatUrl, {
      method: 'POST',
      headers: API_CONFIG.headers,
      body: JSON.stringify({
        model: API_CONFIG.model,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
        ],
      }),
      signal,
    })
    if (!res.ok) {
      let msg = ''
      try {
        const rawText = await res.text()
        try {
          const errJson = JSON.parse(rawText)
          msg = errJson?.error || rawText
        } catch {
          msg = rawText
        }
      } catch {
        msg = res.statusText || 'Unknown error'
      }
      throw new Error(`Ollama error ${res.status}: ${msg}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let full = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n').filter(Boolean)) {
        try {
          const json = JSON.parse(line)
          const token = json.message?.content || ''
          if (token) { full += token; onChunk(full) }
        } catch { /* partial JSON — skip */ }
      }
    }
    return full
  }
}


// ─── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEYS = {
  CONTEXT: 'zeni_project_context',
  SESSIONS: 'zeni_sessions',
}

/** Build the system prompt live from current project context on every call.
 *  If ALL fields are empty → quick-dump mode (no project assumptions).
 *  If ANY field is filled → full project-context mode.
 */
function buildSystemPrompt(projectContext) {
  const hasContext = projectContext.name || projectContext.stack || projectContext.goal

  if (!hasContext) {
    return `You are ZENI — Ayush's private thinking partner. Sharp, direct, never generic. The user is brain dumping freely — random thoughts, errors, ideas, confusion. Just receive it, structure it, and push thinking forward with ONE sharp question. No assumptions about project. Be concise, direct, never generic.

After your response always append:
<structured>
{
  "goals": ["..."],
  "tasks": ["..."],
  "hypotheses": ["..."],
  "nextSteps": ["..."]
}
</structured>`
  }

  return `You are ZENI — Ayush's private thinking partner. Sharp, direct, never generic.

Your personality:
- Direct and concise. Never pad responses with generic advice.
- Push back when ideas are vague or incomplete. Ask ONE sharp question to clarify.
- Never use corporate bullet-point style. Think like a smart technical friend.
- When you agree, say why. When you disagree, say why clearly.
- Always move the thinking FORWARD. Don't summarize what the user just said.

Current project context:
Project: ${projectContext.name || 'Not set'}
Stack: ${projectContext.stack || 'Not set'}
Goal: ${projectContext.goal || 'Not set'}

Rules:
- Always relate your response to the current project context above.
- Keep responses under 200 words unless the user explicitly asks for detail.
- Never repeat what the user just said back to them.
- End EVERY response with exactly one follow-up question that pushes thinking forward.

After your response always append:
<structured>
{
  "goals": ["..."],
  "tasks": ["..."],
  "hypotheses": ["..."],
  "nextSteps": ["..."]
}
</structured>`
}

const EMPTY_STRUCTURED = { goals: [], tasks: [], hypotheses: [], nextSteps: [] }

// ─── Power System ─────────────────────────────────────────────────────────────
const transformations = [
  { name: 'ZENI AWAKENED',  minPower: 0,      colors: { accent: '#7c3aed', glow: 'rgba(124,58,237,0.3)',   bg: '#000000', panel: '#060608', border: '#1a1a2e', text: '#e2e8f0', dragon: 'invert(1) sepia(1) saturate(5) hue-rotate(240deg) brightness(0.8)' } },
  { name: 'ZENI KAIOKEN',   minPower: 500,    colors: { accent: '#dc2626', glow: 'rgba(220,38,38,0.4)',   bg: '#0a0000', panel: '#100505', border: '#2a0a0a', text: '#fecaca', dragon: 'invert(1) sepia(1) saturate(8) hue-rotate(300deg) brightness(0.9)' } },
  { name: 'ZENI GOLDEN',    minPower: 1500,   colors: { accent: '#fbbf24', glow: 'rgba(251,191,36,0.4)', bg: '#0a0800', panel: '#100e00', border: '#2a2000', text: '#fef3c7', dragon: 'invert(1) sepia(1) saturate(10) hue-rotate(15deg) brightness(1.2)' } },
  { name: 'ZENI CHARGED',   minPower: 4000,   colors: { accent: '#f59e0b', glow: 'rgba(245,158,11,0.5)', bg: '#0a0900', panel: '#121000', border: '#2a2500', text: '#fde68a', dragon: 'invert(1) sepia(1) saturate(12) hue-rotate(20deg) brightness(1.4)' } },
  { name: 'ZENI UNLEASHED', minPower: 9000,   colors: { accent: '#f97316', glow: 'rgba(249,115,22,0.5)', bg: '#0a0500', panel: '#120800', border: '#2a1500', text: '#fed7aa', dragon: 'invert(1) sepia(1) saturate(10) hue-rotate(350deg) brightness(1.3)' } },
  { name: 'ZENI DIVINE',    minPower: 20000,  colors: { accent: '#ef4444', glow: 'rgba(239,68,68,0.5)',  bg: '#0a0000', panel: '#150000', border: '#3a0000', text: '#fca5a5', dragon: 'invert(1) sepia(1) saturate(8) hue-rotate(310deg) brightness(1.1)' } },
  { name: 'ZENI ASCENDED',  minPower: 40000,  colors: { accent: '#06b6d4', glow: 'rgba(6,182,212,0.5)',  bg: '#00080a', panel: '#001215', border: '#002a30', text: '#a5f3fc', dragon: 'invert(1) sepia(1) saturate(8) hue-rotate(170deg) brightness(1.1)' } },
  { name: 'ZENI INSTINCT',  minPower: 80000,  colors: { accent: '#94a3b8', glow: 'rgba(148,163,184,0.5)', bg: '#05050a', panel: '#0a0a12', border: '#1a1a2e', text: '#e2e8f0', dragon: 'invert(1) brightness(2) saturate(0)' } },
  { name: 'ZENI PERFECTED', minPower: 150000, colors: { accent: '#ffffff', glow: 'rgba(255,255,255,0.4)', bg: '#030305', panel: '#080810', border: '#ffffff22', text: '#ffffff', dragon: 'invert(1) brightness(3) saturate(0)' } },
  { name: 'ZENI INFINITE',  minPower: 300000, colors: { accent: '#a78bfa', glow: 'rgba(167,139,250,0.6)', bg: '#000000', panel: '#05050f', border: '#a78bfa33', text: '#f0e6ff', dragon: 'invert(1) sepia(1) saturate(3) hue-rotate(220deg) brightness(1.5)' } },
]

const calculatePower = (data) =>
  (data.sessions * 100) + (Math.floor(data.hoursSpent) * 500) +
  (data.problemsSolved * 200) + (data.promptsGenerated * 150)

const getCurrentForm = (power) => {
  const eligible = transformations.filter(t => power >= t.minPower)
  return eligible[eligible.length - 1]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatTimestamp(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

const parseStructured = (fullText) => {
  try {
    // Try <structured> tags first
    const tagMatch = fullText.match(/<structured>([\s\S]*?)<\/structured>/i);
    if (tagMatch) {
      return JSON.parse(tagMatch[1].trim());
    }
    // Try raw JSON block as fallback
    const jsonMatch = fullText.match(/\{[\s\S]*"goals"[\s\S]*"tasks"[\s\S]*\}/i);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (e) {
    return null;
  }
};

function stripStructured(text) {
  return text.replace(/<structured>[\s\S]*?(<\/structured>|$)/g, '').trim()
}

/** Very lightweight markdown-ish renderer */
function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // code blocks
    .replace(/```[\s\S]*?```/g, m => {
      const inner = m.slice(3, -3).replace(/^\w+\n/, '')
      return `<pre><code>${inner}</code></pre>`
    })
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // bullet lines
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    // numbered lines
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // double newline → paragraph break
    .replace(/\n{2,}/g, '</p><p>')
    // single newline
    .replace(/\n/g, '<br/>')
  return `<p>${html}</p>`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DotPulse() {
  return (
    <div className="dot-pulse flex items-center h-5 px-1">
      <span /><span /><span />
    </div>
  )
}

function StructuredSection({ label, color, borderColor, icon, items }) {
  const bc = borderColor || '#1a1a2e'
  return (
    <div style={{
      margin: '8px 12px', background: `${color}06`, border: `1px solid ${bc}`,
      borderRadius: '8px', overflow: 'hidden'
    }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: `1px solid ${bc}`, cursor: 'pointer' }}>
        <span style={{ color }}>{icon}</span>
        <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '2px', color }}>{label.toUpperCase()}</span>
      </div>
      <div>
        {(!items || items.length === 0) ? (
          <div style={{ padding: '12px 14px', fontSize: '11px', color: '#2d3748', fontStyle: 'italic' }}>
            No data yet — start a conversation
          </div>
        ) : (
          items.map((item, i) => (
            <div key={i} style={{ padding: '8px 14px', fontSize: '12px', color: `${color}cc`, borderBottom: `1px solid ${bc}55`, lineHeight: '1.5' }}>
              {item}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ChatMessage({ msg, onSnap, snapCopied, accentColor, borderColor, textColor }) {
  const isUser = msg.role === 'user'
  const tc = textColor || '#e2e8f0'
  const isStreaming = msg.streaming
  return (
    <div className={`msg-appear flex gap-3 mb-5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
        style={{
          background: isUser ? `${accentColor}22` : 'transparent',
          border: isUser ? `1px solid ${accentColor}55` : 'none',
          color: isUser ? accentColor : 'transparent',
          fontSize: '12px', fontWeight: '700',
        }}
      >
        {isUser ? 'U' : (
          <svg width="28" height="28" viewBox="0 0 36 36"
            style={{
              filter: `drop-shadow(0 0 ${isStreaming ? '10px' : '4px'} ${accentColor})`,
              animation: isStreaming
                ? 'zElectric 0.15s ease-in-out infinite alternate'
                : 'zPulse 3s ease-in-out infinite'
            }}
          >
            <line x1="7" y1="7" x2="29" y2="7" stroke={accentColor} strokeWidth="3" strokeLinecap="round"/>
            <line x1="29" y1="7" x2="20" y2="17" stroke={accentColor} strokeWidth="3" strokeLinecap="round"/>
            <circle cx="18" cy="18" r="2.5" fill={accentColor}/>
            <circle cx="18" cy="18" r="1.1" fill="#ffffff" opacity={isStreaming ? 1 : 0.5}/>
            <line x1="16" y1="19" x2="7" y2="29" stroke={accentColor} strokeWidth="3" strokeLinecap="round"/>
            <line x1="7" y1="29" x2="29" y2="29" stroke={accentColor} strokeWidth="3" strokeLinecap="round"/>
            {isStreaming && (
              <>
                <circle cx="14" cy="14" r="1.3" fill={accentColor} opacity="0.9"/>
                <circle cx="22" cy="22" r="1.3" fill={accentColor} opacity="0.9"/>
                <circle cx="21" cy="13" r="0.9" fill="#ffffff" opacity="1"/>
                <circle cx="15" cy="23" r="0.9" fill="#ffffff" opacity="1"/>
              </>
            )}
          </svg>
        )}
      </div>

      {/* Bubble */}
      <div className={`flex flex-col max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`${isUser ? '' : 'ai-message'} ${msg.streaming ? 'cursor-blink' : ''}`}
          style={isUser ? {
            padding: '12px 16px', margin: '8px 0', background: `${accentColor}14`,
            border: `1px solid ${accentColor}33`, borderRadius: '8px',
            fontSize: '14px', animation: 'fadeInUp 0.3s ease', color: tc
          } : {
            padding: '16px 20px', margin: '8px 0', background: `${accentColor}08`,
            borderLeft: `2px solid ${accentColor}`, borderRadius: '4px',
            fontSize: '14px', lineHeight: '1.7', color: `${tc}cc`, animation: 'fadeInUp 0.3s ease'
          }}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(stripStructured(msg.content)) }} />
          )}
        </div>
        {/* SNAP button on AI messages */}
        {!isUser && !msg.streaming && onSnap && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 4px', opacity: 0.7 }}>
            <button
              onClick={onSnap}
              style={{
                background: 'transparent', border: `1px solid ${borderColor}`,
                borderRadius: '6px', padding: '3px 10px',
                color: snapCopied ? '#10b981' : accentColor,
                fontSize: '10px', letterSpacing: '1px', cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {snapCopied ? '✅ COPIED' : '⚡ SNAP'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const AnimeBackgrounds = () => (
  <div style={{position:'fixed', right:0, bottom:0, pointerEvents:'none', zIndex:0}}>
    {/* Character 1 — Spiky hair warrior (Goku style) */}
    <svg className="anime-bg" style={{animationDelay:'0s'}} viewBox="0 0 300 400">
      <defs>
        <radialGradient id="aura1" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="150" cy="250" rx="120" ry="150" fill="url(#aura1)" className="power-aura"/>
      {/* Body */}
      <rect x="120" y="180" width="60" height="120" rx="10" fill="#7c3aed" opacity="0.4"/>
      {/* Head */}
      <ellipse cx="150" cy="160" rx="30" ry="35" fill="#7c3aed" opacity="0.5"/>
      {/* Spiky hair */}
      <polygon points="150,125 140,95 155,115" fill="#fbbf24" opacity="0.7"/>
      <polygon points="150,125 165,90 158,118" fill="#fbbf24" opacity="0.7"/>
      <polygon points="145,128 130,95 142,120" fill="#fbbf24" opacity="0.6"/>
      <polygon points="155,128 172,98 160,122" fill="#fbbf24" opacity="0.6"/>
      <polygon points="148,130 125,105 138,125" fill="#fbbf24" opacity="0.5"/>
      {/* Eyes glow */}
      <ellipse cx="140" cy="158" rx="5" ry="4" fill="#fbbf24" opacity="0.8"/>
      <ellipse cx="160" cy="158" rx="5" ry="4" fill="#fbbf24" opacity="0.8"/>
      {/* Arms */}
      <rect x="85" y="185" width="35" height="15" rx="7" fill="#7c3aed" opacity="0.4" transform="rotate(-20,85,185)"/>
      <rect x="180" y="185" width="35" height="15" rx="7" fill="#7c3aed" opacity="0.4" transform="rotate(20,215,185)"/>
      {/* Energy lines */}
      <line x1="50" y1="300" x2="150" y2="200" stroke="#fbbf24" strokeWidth="1" opacity="0.3"/>
      <line x1="250" y1="300" x2="150" y2="200" stroke="#fbbf24" strokeWidth="1" opacity="0.3"/>
      <line x1="150" y1="350" x2="150" y2="150" stroke="#7c3aed" strokeWidth="1" opacity="0.2"/>
    </svg>

    {/* Character 2 — Calm eyes long hair (Itachi style) */}
    <svg className="anime-bg" style={{animationDelay:'30s'}} viewBox="0 0 300 400">
      <defs>
        <radialGradient id="aura2" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#dc2626" stopOpacity="0.2"/>
          <stop offset="100%" stopColor="#000" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="150" cy="250" rx="100" ry="140" fill="url(#aura2)"/>
      {/* Body with cloak */}
      <path d="M100,180 L80,350 L220,350 L200,180 Z" fill="#1a0a2e" opacity="0.6"/>
      <path d="M100,180 L80,350 L220,350 L200,180 Z" fill="none" stroke="#dc2626" strokeWidth="1" opacity="0.4"/>
      {/* Head */}
      <ellipse cx="150" cy="155" rx="28" ry="32" fill="#7c3aed" opacity="0.5"/>
      {/* Long hair */}
      <path d="M122,155 C110,180 105,220 115,260" stroke="#1a0a2e" strokeWidth="12" fill="none" opacity="0.8"/>
      <path d="M178,155 C190,180 195,220 185,260" stroke="#1a0a2e" strokeWidth="12" fill="none" opacity="0.8"/>
      {/* Sharingan eyes */}
      <circle cx="138" cy="152" r="6" fill="#dc2626" opacity="0.9"/>
      <circle cx="162" cy="152" r="6" fill="#dc2626" opacity="0.9"/>
      <circle cx="138" cy="152" r="2" fill="#000" opacity="0.9"/>
      <circle cx="162" cy="152" r="2" fill="#000" opacity="0.9"/>
      {/* Falling feathers */}
      <ellipse cx="100" cy="200" rx="4" ry="10" fill="#1a0a2e" opacity="0.6" transform="rotate(-30,100,200)"/>
      <ellipse cx="200" cy="230" rx="4" ry="10" fill="#1a0a2e" opacity="0.6" transform="rotate(20,200,230)"/>
      <ellipse cx="80" cy="280" rx="3" ry="8" fill="#1a0a2e" opacity="0.5" transform="rotate(-10,80,280)"/>
    </svg>

    {/* Character 3 — Headband ninja (Naruto style) */}
    <svg className="anime-bg" style={{animationDelay:'60s'}} viewBox="0 0 300 400">
      <defs>
        <radialGradient id="aura3" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="150" cy="250" rx="110" ry="140" fill="url(#aura3)" className="power-aura"/>
      {/* Body */}
      <rect x="115" y="185" width="70" height="130" rx="12" fill="#f97316" opacity="0.35"/>
      {/* Head */}
      <ellipse cx="150" cy="158" rx="32" ry="36" fill="#7c3aed" opacity="0.45"/>
      {/* Spiky short hair */}
      <polygon points="150,122 143,100 152,118" fill="#f97316" opacity="0.7"/>
      <polygon points="155,120 163,98 157,117" fill="#f97316" opacity="0.7"/>
      <polygon points="144,122 134,102 141,119" fill="#f97316" opacity="0.6"/>
      {/* Headband */}
      <rect x="118" y="130" width="64" height="10" rx="3" fill="#7c3aed" opacity="0.7"/>
      <rect x="140" y="128" width="20" height="14" rx="2" fill="#fbbf24" opacity="0.6"/>
      {/* Whisker marks */}
      <line x1="128" y1="160" x2="142" y2="158" stroke="#f97316" strokeWidth="1.5" opacity="0.7"/>
      <line x1="158" y1="158" x2="172" y2="160" stroke="#f97316" strokeWidth="1.5" opacity="0.7"/>
      {/* Eyes */}
      <ellipse cx="139" cy="155" rx="5" ry="4" fill="#1a6b9a" opacity="0.9"/>
      <ellipse cx="161" cy="155" rx="5" ry="4" fill="#1a6b9a" opacity="0.9"/>
      {/* Chakra swirls */}
      <circle cx="150" cy="220" r="20" fill="none" stroke="#f97316" strokeWidth="1" opacity="0.3"/>
      <circle cx="150" cy="220" r="35" fill="none" stroke="#f97316" strokeWidth="0.5" opacity="0.2"/>
    </svg>

    {/* Character 4 — Rinnegan god (Pain style) */}
    <svg className="anime-bg" style={{animationDelay:'90s'}} viewBox="0 0 300 400">
      <defs>
        <radialGradient id="aura4" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.4"/>
          <stop offset="100%" stopColor="#000" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="150" cy="200" rx="140" ry="180" fill="url(#aura4)" className="power-aura"/>
      {/* Floating rocks */}
      <rect x="60" y="150" width="25" height="20" rx="3" fill="#374151" opacity="0.4" transform="rotate(-15,60,150)"/>
      <rect x="220" y="180" width="20" height="15" rx="3" fill="#374151" opacity="0.4" transform="rotate(10,220,180)"/>
      <rect x="80" y="280" width="30" height="22" rx="3" fill="#374151" opacity="0.3" transform="rotate(5,80,280)"/>
      {/* Body */}
      <rect x="115" y="180" width="70" height="140" rx="8" fill="#1a0a2e" opacity="0.6"/>
      {/* Head */}
      <ellipse cx="150" cy="155" rx="30" ry="33" fill="#7c3aed" opacity="0.5"/>
      {/* Rinnegan eyes */}
      <circle cx="138" cy="152" r="7" fill="#7c3aed" opacity="1"/>
      <circle cx="162" cy="152" r="7" fill="#7c3aed" opacity="1"/>
      <circle cx="138" cy="152" r="3" fill="#4c1d95" opacity="1"/>
      <circle cx="162" cy="152" r="3" fill="#4c1d95" opacity="1"/>
      {/* Piercings */}
      <circle cx="150" cy="170" r="2" fill="#fbbf24" opacity="0.8"/>
      <circle cx="138" cy="165" r="1.5" fill="#fbbf24" opacity="0.8"/>
      <circle cx="162" cy="165" r="1.5" fill="#fbbf24" opacity="0.8"/>
      {/* Gravity lines */}
      <line x1="150" y1="50" x2="150" y2="150" stroke="#7c3aed" strokeWidth="1" opacity="0.3"/>
      <line x1="50" y1="150" x2="150" y2="150" stroke="#7c3aed" strokeWidth="1" opacity="0.2"/>
      <line x1="250" y1="150" x2="150" y2="150" stroke="#7c3aed" strokeWidth="1" opacity="0.2"/>
    </svg>

    {/* Character 5 — Prince rival (Vegeta style) */}
    <svg className="anime-bg" style={{animationDelay:'120s'}} viewBox="0 0 300 400">
      <defs>
        <radialGradient id="aura5" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.35"/>
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="150" cy="230" rx="115" ry="150" fill="url(#aura5)" className="power-aura"/>
      {/* Body armor feel */}
      <rect x="112" y="178" width="76" height="130" rx="6" fill="#1a0a2e" opacity="0.55"/>
      <rect x="108" y="178" width="20" height="60" rx="4" fill="#7c3aed" opacity="0.4"/>
      <rect x="172" y="178" width="20" height="60" rx="4" fill="#7c3aed" opacity="0.4"/>
      {/* Head */}
      <ellipse cx="150" cy="152" rx="29" ry="33" fill="#7c3aed" opacity="0.5"/>
      {/* Tall spiky hair — Vegeta signature */}
      <polygon points="150,119 144,80 152,112" fill="#1a0a2e" opacity="0.9"/>
      <polygon points="152,117 162,75 157,110" fill="#1a0a2e" opacity="0.9"/>
      <polygon points="146,119 134,82 143,113" fill="#1a0a2e" opacity="0.8"/>
      <polygon points="156,117 170,85 161,112" fill="#1a0a2e" opacity="0.8"/>
      {/* Stern eyes */}
      <ellipse cx="138" cy="150" rx="6" ry="4" fill="#1a0a2e" opacity="0.9"/>
      <ellipse cx="162" cy="150" rx="6" ry="4" fill="#1a0a2e" opacity="0.9"/>
      <line x1="130" y1="144" x2="148" y2="147" stroke="#1a0a2e" strokeWidth="2" opacity="0.8"/>
      <line x1="152" y1="147" x2="170" y2="144" stroke="#1a0a2e" strokeWidth="2" opacity="0.8"/>
      {/* Energy blast charging */}
      <circle cx="90" cy="220" r="15" fill="#fbbf24" opacity="0.2"/>
      <circle cx="90" cy="220" r="8" fill="#fbbf24" opacity="0.3"/>
      <line x1="90" y1="220" x2="150" y2="200" stroke="#fbbf24" strokeWidth="1" opacity="0.3"/>
    </svg>
  </div>
);

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  // Project context
  const [projectName, setProjectName] = useState('')
  const [projectStack, setProjectStack] = useState('')
  const [projectGoal, setProjectGoal] = useState('')

  // Sessions
  const [sessions, setSessions] = useState([])          // [{id,title,ts,messages,structured}]
  const [activeSessionId, setActiveSessionId] = useState(null)

  // Current session data
  const [messages, setMessages] = useState([])
  const [structured, setStructured] = useState(EMPTY_STRUCTURED)

  // UI state
  const [contextExpanded, setContextExpanded] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isGujaratiMode, setIsGujaratiMode] = useState(() => localStorage.getItem('zeni_lang') !== 'false')
  const [isFixCopied, setIsFixCopied] = useState(false)

  const [editingSessionId, setEditingSessionId] = useState(null)
  const [editingTitle, setEditingTitle] = useState('')

  // THINK / FORGE mode
  const [activeMode, setActiveMode] = useState('think')
  const [forgeContent, setForgeContent] = useState('')
  const [forgeLabel, setForgeLabel] = useState('')
  const [forgeCopied, setForgeCopied] = useState(false)
  const [snapCopied, setSnapCopied] = useState(null) // message index

  // Power system
  const [powerData, setPowerData] = useState(() => {
    try { return JSON.parse(localStorage.getItem('zeni_power')) || { level: 0, form: 'ZENI AWAKENED', sessions: 0, hoursSpent: 0, problemsSolved: 0, promptsGenerated: 0, sessionStartTime: Date.now() } }
    catch { return { level: 0, form: 'ZENI AWAKENED', sessions: 0, hoursSpent: 0, problemsSolved: 0, promptsGenerated: 0, sessionStartTime: Date.now() } }
  })
  const [levelUpShow, setLevelUpShow] = useState(false)
  const [levelUpName, setLevelUpName] = useState('')

  const chatEndRef = useRef(null)
  const textareaRef = useRef(null)
  const abortRef = useRef(null)

  // ── Power: tick time every minute ───────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setPowerData(prev => {
        const elapsed = (Date.now() - prev.sessionStartTime) / 3600000
        const updated = { ...prev, hoursSpent: prev.hoursSpent + elapsed / 60, sessionStartTime: Date.now() }
        localStorage.setItem('zeni_power', JSON.stringify(updated))
        return updated
      })
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  // ── Power: check for level up ─────────────────────────────────────────────
  useEffect(() => {
    const power = calculatePower(powerData)
    const newForm = getCurrentForm(power)
    if (newForm.name !== powerData.form) {
      setPowerData(prev => {
        const updated = { ...prev, form: newForm.name }
        localStorage.setItem('zeni_power', JSON.stringify(updated))
        return updated
      })
      setLevelUpName(newForm.name)
      setLevelUpShow(true)
      setTimeout(() => setLevelUpShow(false), 4000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [powerData.sessions, powerData.hoursSpent, powerData.problemsSolved, powerData.promptsGenerated])

  // ── Bootstrap from localStorage ──────────────────────────────────────────
  useEffect(() => {
    const ctx = JSON.parse(localStorage.getItem(STORAGE_KEYS.CONTEXT) || '{}')
    setProjectName(ctx.name || '')
    setProjectStack(ctx.stack || '')
    setProjectGoal(ctx.goal || '')

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]')
    setSessions(saved)
    if (saved.length > 0) {
      loadSession(saved[0], saved)
    } else {
      startNewSession(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Persist context ───────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CONTEXT, JSON.stringify({ name: projectName, stack: projectStack, goal: projectGoal }))
  }, [projectName, projectStack, projectGoal])

  useEffect(() => {
    localStorage.setItem('zeni_lang', isGujaratiMode)
  }, [isGujaratiMode])

  // ── Auto scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Session helpers ───────────────────────────────────────────────────────
  const persistSessions = useCallback((updated) => {
    setSessions(updated)
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(updated))
  }, [])

  const startNewSession = useCallback((persist = true) => {
    const id = generateId()
    const session = {
      id,
      title: 'New session',
      ts: new Date().toISOString(),
      messages: [],
      structured: EMPTY_STRUCTURED,
    }
    setActiveSessionId(id)
    setMessages([])
    setStructured(EMPTY_STRUCTURED)
    setError('')
    // Only count power XP when user explicitly starts a new session, not on bootstrap
    if (persist) {
      setPowerData(prev => {
        const updated = { ...prev, sessions: prev.sessions + 1, sessionStartTime: Date.now() }
        localStorage.setItem('zeni_power', JSON.stringify(updated))
        return updated
      })
      persistSessions(prev => {
        const updated = [session, ...prev]
        localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(updated))
        return updated
      })
    }
  }, [persistSessions])

  const loadSession = useCallback((session, list) => {
    const src = list || sessions
    const found = src.find(s => s.id === session.id) || session
    setActiveSessionId(found.id)
    setMessages(found.messages || [])
    setStructured(found.structured || EMPTY_STRUCTURED)
    setError('')
  }, [sessions])

  /** Save updated messages/structured back into sessions array.
   *  titleOverride — when provided skips the content-derived fallback title. */
  const saveToSession = useCallback((id, updatedMessages, updatedStructured, titleOverride) => {
    setSessions(prev => {
      const title = titleOverride
        || updatedMessages.find(m => m.role === 'user')?.content?.slice(0, 40)
        || 'New session'
      const updated = prev.map(s =>
        s.id === id ? { ...s, title, messages: updatedMessages, structured: updatedStructured } : s
      )
      localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(updated))
      return updated
    })
  }, [])

  /** Silently generate a 4-6 word session title from the first user message.
   *  Fires once after the first AI response. Updates sidebar in real time. */
  const autoNameSession = useCallback(async (sessionId, firstUserMessage) => {
    try {
      const sessionName = await callLLM(
        `Based on this user message, generate a 4-6 word session title. Return ONLY the title, nothing else, no quotes, no punctuation at the end.\n\nUser message: "${firstUserMessage}"`
      ) || firstUserMessage.slice(0, 40)
      // Patch just the title in the sessions list — messages/structured unchanged
      setSessions(prev => {
        const updated = prev.map(s =>
          s.id === sessionId ? { ...s, title: sessionName } : s
        )
        localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(updated))
        return updated
      })
    } catch {
      // Naming failed — fallback title was already set by saveToSession, nothing to do
    }
  }, [])

  const deleteSession = (e, id) => {
    e.stopPropagation()
    if (window.confirm("Delete this session?")) {
      setSessions(prev => {
        const updated = prev.filter(s => s.id !== id)
        localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(updated))
        return updated
      })
      if (activeSessionId === id) {
        startNewSession(false)
      }
    }
  }

  const startRename = (e, s) => {
    e.stopPropagation()
    setEditingSessionId(s.id)
    setEditingTitle(s.title)
  }

  const saveRename = (id) => {
    if (editingTitle.trim()) {
      setSessions(prev => {
        const updated = prev.map(s => s.id === id ? { ...s, title: editingTitle.trim() } : s)
        localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(updated))
        return updated
      })
    }
    setEditingSessionId(null)
  }

  const handleRenameKeyDown = (e, id) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveRename(id)
    }
  }

  // ── Ollama streaming call ─────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setError('')
    setLoading(true)

    let finalUserText = text
    let isTranslated = false

    if (isGujaratiMode) {
      try {
        const translated = await callLLM(
          `Translate this Gujarati text to clear English. Return ONLY the English translation, nothing else:\n\n${text}`
        )
        if (translated) {
          finalUserText = translated
          isTranslated = true
        }
      } catch (err) {
        console.error('Translation failed:', err)
      }
    }

    const userMsg = { id: generateId(), role: 'user', content: finalUserText, translated: isTranslated }
    const assistantMsg = { id: generateId(), role: 'assistant', content: '', streaming: true }

    const updatedMessages = [...messages, userMsg, assistantMsg]
    setMessages(updatedMessages)

    // Build dynamic system prompt from live context state
    const systemPrompt = buildSystemPrompt({ name: projectName, stack: projectStack, goal: projectGoal })

    // History for the LLM — exclude streaming placeholders
    const history = [
      ...messages
        .filter(m => !m.streaming)
        .map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]

    // Abort controller
    const controller = new AbortController()
    abortRef.current = controller

    let fullContent = ''

    try {
      fullContent = await streamLLM(
        systemPrompt,
        history,
        controller.signal,
        (accumulated) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMsg.id ? { ...m, content: accumulated } : m
            )
          )
        }
      )

      // ── Parse structured output ──────────────────────────────────────────
      const parsedStructured = parseStructured(fullContent)
      if (parsedStructured) {
        setStructured(parsedStructured)
      }

      let finalCleanText = fullContent.replace(/<structured>[\s\S]*?(<\/structured>|$)/i, '')
      if (!fullContent.match(/<structured>/i)) {
        finalCleanText = finalCleanText.replace(/\{[\s\S]*"goals"[\s\S]*"tasks"[\s\S]*\}/i, '')
      }
      finalCleanText = finalCleanText.trim()

      const finalMessages = updatedMessages.map(m =>
        m.id === assistantMsg.id ? { ...m, content: finalCleanText, streaming: false } : m
      )
      setMessages(finalMessages)
      saveToSession(activeSessionId, finalMessages, parsedStructured || structured)

      // ── Auto-name: only fires on the very first exchange ─────────────────
      // messages (captured in closure) reflects state BEFORE this turn,
      // so length === 0 means this was the first user message.
      if (messages.length === 0) {
        autoNameSession(activeSessionId, text)
      }

    } catch (err) {
      if (err.name === 'AbortError') return
      const errMsg = err.message.includes('fetch')
        ? 'Cannot reach Ollama at localhost:11434. Is it running?'
        : err.message
      setError(errMsg)
      // Remove the empty assistant message
      setMessages(prev => prev.filter(m => m.id !== assistantMsg.id))
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [input, loading, messages, projectName, projectStack, projectGoal, activeSessionId, saveToSession, autoNameSession, isGujaratiMode])


  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Copy as Prompt ────────────────────────────────────────────────────────
  const copyAsPrompt = useCallback(() => {
    const lines = ['# ZENI Session Export\n']

    if (projectName || projectStack) {
      lines.push(`**Project:** ${projectName || 'Untitled'}`)
      lines.push(`**Stack:** ${projectStack || 'Not specified'}\n`)
    }

    lines.push('## Conversation\n')
    messages.filter(m => !m.streaming).forEach(m => {
      lines.push(`**${m.role === 'user' ? 'Me' : 'ZENI'}:** ${stripStructured(m.content)}\n`)
    })

    if (structured.goals?.length || structured.tasks?.length || structured.hypotheses?.length || structured.nextSteps?.length) {
      lines.push('\n## Structured Output\n')
      if (structured.goals?.length)       lines.push(`**Goals:** ${structured.goals.join(' | ')}`)
      if (structured.tasks?.length)       lines.push(`**Tasks:** ${structured.tasks.join(' | ')}`)
      if (structured.hypotheses?.length)  lines.push(`**Hypotheses:** ${structured.hypotheses.join(' | ')}`)
      if (structured.nextSteps?.length)   lines.push(`**Next Steps:** ${structured.nextSteps.join(' | ')}`)
    }

    lines.push('\n---\nContinue from here:')

    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => {
        setError('') // clear error
        // Flash feedback — temporarily show a toast
        const toast = document.getElementById('copy-toast')
        if (toast) { toast.style.opacity = '1'; setTimeout(() => { toast.style.opacity = '0' }, 2000) }
      })
      .catch(() => setError('Failed to copy to clipboard.'))
  }, [messages, structured, projectName, projectStack])

  // ── Export Session ────────────────────────────────────────────────────────
  const exportSession = useCallback(() => {
    const date = new Date()
    const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const name = projectName || 'session'

    // ── Build markdown ───────────────────────────────────────────────────
    const lines = []
    lines.push('# ZENI — Session Export')
    lines.push('')
    lines.push(`**Project:** ${projectName || 'Untitled'}`)
    lines.push(`**Stack:** ${projectStack || 'Not specified'}`)
    lines.push(`**Date:** ${dateStr}`)
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push('## Conversation')
    lines.push('')

    messages.filter(m => !m.streaming).forEach(m => {
      const label = m.role === 'user' ? '**You:**' : '**ZENI:**'
      lines.push(`${label} ${stripStructured(m.content)}`)
      lines.push('')
    })

    lines.push('---')
    lines.push('')
    lines.push('## Structured Output')
    lines.push('')

    const s = structured
    if (s.goals?.length) {
      lines.push('### Goals')
      s.goals.forEach(g => lines.push(`- ${g}`))
      lines.push('')
    }
    if (s.tasks?.length) {
      lines.push('### Tasks')
      s.tasks.forEach(t => lines.push(`- ${t}`))
      lines.push('')
    }
    if (s.hypotheses?.length) {
      lines.push('### Hypotheses')
      s.hypotheses.forEach(h => lines.push(`- ${h}`))
      lines.push('')
    }
    if (s.nextSteps?.length) {
      lines.push('### Next Steps')
      s.nextSteps.forEach(n => lines.push(`- ${n}`))
      lines.push('')
    }

    lines.push('---')
    lines.push('')
    lines.push('## Generated Prompt')
    lines.push('')
    lines.push('Use this to continue in Cursor, Claude, or ChatGPT:')
    lines.push('')
    lines.push('---')
    lines.push(`Project: ${projectName || 'Not set'}`)
    lines.push(`Stack: ${projectStack || 'Not set'}`)
    lines.push(`Goal: ${projectGoal || 'Not set'}`)
    lines.push('')
    lines.push('Continue helping me from here.')
    lines.push('---')

    // ── Trigger download ─────────────────────────────────────────────────
    const markdown = lines.join('\n')
    const blob = new Blob([markdown], { type: 'text/plain;charset=utf-8' })
    const isoDate = date.toISOString().slice(0, 10)
    const filename = `zeni-session-${isoDate}.md`

    if (window.navigator.msSaveOrOpenBlob) {
      window.navigator.msSaveOrOpenBlob(blob, filename)
    } else {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.setAttribute('download', filename)
      a.setAttribute('target', '_self')
      document.body.appendChild(a)
      setTimeout(() => {
        a.click()
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 100)
      }, 0)
    }
  }, [messages, structured, projectName, projectStack, projectGoal])

  // ── Enhance Prompt (FORGE mode) ───────────────────────────────────────────
  const enhancePrompt = useCallback(async () => {
    const raw = forgeContent.trim()
    if (!raw || loading) return
    setLoading(true)
    try {
      const enhanced = await callLLM(
        `You are a prompt engineer. Rewrite this rough prompt as a clear, complete, actionable instruction for an AI coding agent.\n\nRules:\n- Understand what user actually wants\n- Add missing technical context\n- Be specific and direct\n- No explanation — return ONLY the enhanced prompt\n- End with: "Build this now."\n\nProject: ${projectName || 'not specified'}\nStack: ${projectStack || 'not specified'}\n\nRough prompt: "${raw}"\n\nEnhanced prompt:`
      )
      if (enhanced) {
        setForgeContent(enhanced)
        setForgeLabel('✨ Enhanced by ZENI — edit if needed')
      }
    } catch (err) {
      setError('Enhancement failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [forgeContent, loading, projectName, projectStack])

  // ── Ready to Build ────────────────────────────────────────────────────────
  const readyToBuild = useCallback(async () => {
    setLoading(true)
    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'Ayush' : 'ZENI'}: ${stripStructured(m.content)}`)
      .join('\n\n')
    try {
      const buildPrompt = await callLLM(
        `You are an expert prompt engineer.\n\nConvert this COMPLETE thinking session into ONE perfect build prompt for an AI coding agent to execute immediately.\n\nRules:\n- Include ALL context and decisions\n- Be specific and technical\n- List every feature in order of priority\n- Include stack, project name, goals\n- Make it immediately executable\n- End with: "Build this now. Ask if anything unclear."\n\nProject: ${projectName || 'not specified'}\nStack: ${projectStack || 'not specified'}\nGoal: ${projectGoal || 'not specified'}\n\nComplete session:\n${conversationText}\n\nFinal structured output:\nGoals: ${structured.goals?.join(', ') || 'none'}\nTasks: ${structured.tasks?.join(', ') || 'none'}\nHypotheses: ${structured.hypotheses?.join(', ') || 'none'}\nNext Steps: ${structured.nextSteps?.join(', ') || 'none'}\n\nGenerate the complete build prompt now:`
      )
      setActiveMode('forge')
      setForgeContent(buildPrompt)
      setForgeLabel('🚀 Generated from complete THINK session — ready to paste in Antigravity')
      setPowerData(prev => {
        const updated = { ...prev, promptsGenerated: prev.promptsGenerated + 1 }
        localStorage.setItem('zeni_power', JSON.stringify(updated))
        return updated
      })
    } catch (err) {
      setError('Failed to generate build prompt: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [messages, structured, projectName, projectStack, projectGoal])

  // ── Snap Prompt (per-message) ────────────────────────────────────────────────
  const snapPrompt = useCallback(async (msgIndex) => {
    setLoading(true)
    const contextMessages = messages.slice(0, msgIndex + 1)
    const conversationText = contextMessages
      .map(m => `${m.role === 'user' ? 'Ayush' : 'ZENI'}: ${stripStructured(m.content)}`)
      .join('\n\n')
    try {
      const snapResult = await callLLM(
        `You are an expert prompt engineer.\n\nBelow is a thinking session between Ayush and ZENI. Convert this into ONE perfect, complete, actionable prompt that an AI coding agent can execute immediately.\n\nRules:\n- Be specific and technical\n- Include all context, stack, goals discussed\n- List exact requirements in order\n- Include all decisions made\n- Ready to paste directly — no explanation\n- End with: "Build this now. Ask if anything unclear."\n\nProject: ${projectName || 'not specified'}\nStack: ${projectStack || 'not specified'}\nGoal: ${projectGoal || 'not specified'}\n\nFull context:\n${conversationText}\n\nStructured output so far:\nGoals: ${structured.goals?.join(', ') || 'none'}\nTasks: ${structured.tasks?.join(', ') || 'none'}\nNext Steps: ${structured.nextSteps?.join(', ') || 'none'}\n\nGenerate the perfect prompt now:`
      )
      await navigator.clipboard.writeText(snapResult)
      setActiveMode('forge')
      setForgeContent(snapResult)
      setForgeLabel('⚡ SNAPPED from discussion — full context included')
      setPowerData(prev => {
        const updated = { ...prev, promptsGenerated: prev.promptsGenerated + 1 }
        localStorage.setItem('zeni_power', JSON.stringify(updated))
        return updated
      })
      setSnapCopied(msgIndex)
      setTimeout(() => setSnapCopied(null), 2000)
    } catch (err) {
      setError('Snap failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [messages, structured, projectName, projectStack, projectGoal])

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentPower = calculatePower(powerData)
  const currentForm = getCurrentForm(currentPower)
  const C = currentForm.colors  // shorthand

  const hasStructured =
    (structured.goals?.length || structured.tasks?.length ||
      structured.hypotheses?.length || structured.nextSteps?.length)


  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: "'Space Grotesk', sans-serif", display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>

      {/* ── LEVEL UP OVERLAY ── */}
      {levelUpShow && (
        <div style={{
          position: 'fixed', inset: 0,
          background: `radial-gradient(circle, ${C.glow}, transparent 70%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', zIndex: 99999,
          animation: 'levelUpFlash 4s ease forwards',
          pointerEvents: 'none'
        }}>
          <img src="/dragon.png" style={{
            width: '100px', height: '100px',
            filter: C.dragon,
            animation: 'dragonSpin 0.5s linear infinite',
            marginBottom: '20px'
          }}/>
          <div style={{ fontSize: '12px', letterSpacing: '4px', color: C.accent, marginBottom: '8px' }}>ZENI HAS EVOLVED</div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#ffffff', letterSpacing: '6px' }}>{levelUpName}</div>
        </div>
      )}

      {/* ── LEFT SIDEBAR ── */}
      <aside style={{ width: '260px', flexShrink: 0, background: C.panel, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', padding: '0', position: 'relative', zIndex: 1 }}>
        {/* Header section inside sidebar */}
        <div style={{ padding: '20px 16px 16px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            {/* Broken Z Rune Logo — always idle pulse, never affected by LLM */}
            <div style={{ position: 'relative', width: '36px', height: '36px', flexShrink: 0 }}>
              <svg width="36" height="36" viewBox="0 0 36 36"
                style={{
                  filter: `drop-shadow(0 0 6px ${C.accent})`,
                  animation: 'zPulse 3s ease-in-out infinite'
                }}
              >
                <line x1="7" y1="7" x2="29" y2="7" stroke={C.accent} strokeWidth="2.8" strokeLinecap="round"/>
                <line x1="29" y1="7" x2="20" y2="17" stroke={C.accent} strokeWidth="2.8" strokeLinecap="round"/>
                <circle cx="18" cy="18" r="2.2" fill={C.accent}/>
                <circle cx="18" cy="18" r="1" fill="#ffffff" opacity="0.6"/>
                <line x1="16" y1="19" x2="7" y2="29" stroke={C.accent} strokeWidth="2.8" strokeLinecap="round"/>
                <line x1="7" y1="29" x2="29" y2="29" stroke={C.accent} strokeWidth="2.8" strokeLinecap="round"/>
              </svg>
            </div>
            <span style={{ fontSize: '22px', fontWeight: '700', color: '#ffffff', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '3px' }}>ZENI</span>
          </div>
          <div style={{ fontSize: '9px', color: C.accent, letterSpacing: '3px', textTransform: 'uppercase', marginLeft: '46px', opacity: 0.7 }}>{powerData.form}</div>
        </div>

        {/* New Session button */}
        <button
          onClick={() => startNewSession(true)}
          style={{
            margin: '12px 16px', background: `linear-gradient(135deg, ${C.accent}, ${C.accent}aa)`, border: 'none', borderRadius: '8px',
            padding: '10px 16px', color: '#ffffff', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
            width: 'calc(100% - 32px)', boxShadow: `0 0 20px ${C.glow}`, display: 'flex', alignItems: 'center', gap: '8px'
          }}
        >
          <span style={{fontSize: '16px'}}>+</span> New Session
        </button>

        {/* ⚡ POWER LEVEL WIDGET */}
        <div style={{
          margin: '0 12px 8px', padding: '10px 14px',
          background: `${C.accent}0d`, border: `1px solid ${C.border}`, borderRadius: '8px'
        }}>
          <div style={{ fontSize: '9px', letterSpacing: '3px', color: C.accent, marginBottom: '4px' }}>⚡ POWER LEVEL</div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#ffffff', fontFamily: "'JetBrains Mono', monospace" }}>{currentPower.toLocaleString()}</div>
          <div style={{ fontSize: '10px', color: C.accent, letterSpacing: '2px', marginTop: '2px' }}>{powerData.form}</div>
          <div style={{ fontSize: '9px', color: '#4a5568', marginTop: '4px' }}>
            Next: {(() => {
              const next = transformations.find(t => t.minPower > currentPower)
              return next ? `${next.name} at ${next.minPower.toLocaleString()}` : 'MAX FORM REACHED'
            })()}
          </div>
        </div>

        <div style={{ fontSize: '9px', color: '#4a5568', letterSpacing: '3px', textTransform: 'uppercase', padding: '8px 16px 4px' }}>SESSIONS</div>

        <div className="flex-1 overflow-y-auto" style={{ padding: '0 8px' }}>
          {sessions.length === 0 ? (
            <p className="text-xs px-2 mt-2" style={{ color: '#4a5568' }}>No sessions yet.</p>
          ) : (
            sessions.map(s => (
              <button
                key={s.id}
                onClick={() => loadSession(s)}
                className="session-item group w-full text-left relative"
                style={{
                  padding: '8px 12px', margin: '2px 8px', borderRadius: '6px', cursor: 'pointer',
                  border: s.id === activeSessionId ? `1px solid ${C.accent}` : '1px solid transparent',
                  background: s.id === activeSessionId ? `${C.accent}14` : 'transparent',
                  transition: 'all 0.2s ease'
                }}
              >
                {editingSessionId === s.id ? (
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={e => setEditingTitle(e.target.value)}
                    onBlur={() => saveRename(s.id)}
                    onKeyDown={e => handleRenameKeyDown(e, s.id)}
                    onClick={e => e.stopPropagation()}
                    className="text-xs w-full bg-transparent outline-none border-b border-white/20"
                    style={{ color: '#e2e8f0' }}
                  />
                ) : (
                  <>
                    <p className="text-[12px] truncate pr-12" style={{ color: s.id === activeSessionId ? '#e2e8f0' : '#94a3b8' }}>{s.title}</p>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                      <div onClick={(e) => startRename(e, s)} className="text-[10px] p-1 rounded cursor-pointer" style={{background: 'rgba(255,255,255,0.1)'}} title="Rename">✏️</div>
                      <div onClick={(e) => deleteSession(e, s.id)} className="text-[10px] p-1 rounded cursor-pointer" style={{background: 'rgba(239,68,68,0.2)'}} title="Delete">🗑️</div>
                    </div>
                  </>
                )}
                <p className="text-[9px] mt-1" style={{ color: '#4a5568' }}>{formatTimestamp(s.ts)}</p>
              </button>
            ))
          )}
        </div>

        {/* Export Session button */}
        <div style={{ padding: '12px 16px' }}>
          <button
            onClick={exportSession}
            disabled={messages.length === 0}
            style={{
              width: '100%', padding: '8px', borderRadius: '8px', fontSize: '11px',
              background: `${C.accent}1a`, border: `1px solid ${C.accent}33`,
              color: C.accent, letterSpacing: '1px', textAlign: 'center',
              cursor: messages.length === 0 ? 'not-allowed' : 'pointer',
              opacity: messages.length === 0 ? 0.3 : 1, transition: 'all 0.2s ease'
            }}
          >
            ⎘ EXPORT SESSION
          </button>
        </div>

        {/* System status at bottom of sidebar */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: '#4a5568', letterSpacing: '2px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: C.accent, animation: 'systemBlink 2s ease-in-out infinite' }} />
          <span>SYSTEM ONLINE</span>
          <span style={{ fontSize: '9px', color: '#2d3748', marginLeft: 'auto' }}>
            ZENI · {IS_DEMO ? 'llama-3.1-8b-instant · Groq' : 'llama3.2 · Private'}
          </span>
        </div>
      </aside>

      {/* ── CENTER PANEL ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1, background: C.bg }}>
        {/* Demo Mode Banner — only shown when VITE_MODE=demo */}
        {IS_DEMO && (
          <div style={{
            background: 'rgba(251,191,36,0.08)',
            borderBottom: '1px solid rgba(251,191,36,0.25)',
            padding: '6px 24px',
            display: 'flex', alignItems: 'center', gap: '10px',
            fontSize: '11px', letterSpacing: '1px', color: '#fbbf24'
          }}>
            <span style={{ fontSize: '14px' }}>⚡</span>
            <span><strong>DEMO MODE</strong> — Powered by Groq Cloud · Do not enter sensitive information</span>
            <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: '10px' }}>llama-3.1-8b-instant</span>
          </div>
        )}
        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.border}`, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: '600', color: '#ffffff' }}>
              {projectName || 'ZENI Workspace'}
            </h1>
            <div style={{ fontSize: '10px', color: C.accent, letterSpacing: '3px', textTransform: 'uppercase', marginTop: '2px', opacity: 0.7 }}>
              NEURAL INTERFACE ACTIVE
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setContextExpanded(!contextExpanded)}
              style={{
                background: `${C.accent}26`, border: `1px solid ${C.accent}4d`,
                borderRadius: '20px', padding: '6px 14px', fontSize: '11px', color: C.accent, letterSpacing: '1px',
                cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              ⚙ ZENI CORE
            </button>
          </div>
        </div>

        {/* Project Context Editor */}
        {contextExpanded && (
          <div style={{ background: 'rgba(124,58,237,0.05)', padding: '16px 24px', borderBottom: '1px solid #1a1a2e' }}>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>PROJECT NAME</p>
                <input
                  value={projectName} onChange={e => setProjectName(e.target.value)}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.5)', border: '1px solid #1a1a2e', color: '#e2e8f0', padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>TECH STACK</p>
                <input
                  value={projectStack} onChange={e => setProjectStack(e.target.value)}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.5)', border: '1px solid #1a1a2e', color: '#e2e8f0', padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}
                />
              </div>
            </div>
            <div>
              <p style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>PROJECT GOAL</p>
              <textarea
                value={projectGoal} onChange={e => setProjectGoal(e.target.value)} rows={2}
                style={{ width: '100%', background: 'rgba(0,0,0,0.5)', border: '1px solid #1a1a2e', color: '#e2e8f0', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', resize: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button
                onClick={() => { setProjectName(''); setProjectStack(''); setProjectGoal(''); }}
                style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '4px 12px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer' }}
              >
                Clear Data
              </button>
            </div>
          </div>
        )}

        {/* Chat thread */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '80px 20px' }}>
              <div style={{ fontSize: '20px', fontWeight: '600', color: '#ffffff', letterSpacing: '2px', marginBottom: '8px' }}>
                ZENI is ready
              </div>
              <div style={{ fontSize: '12px', color: '#4a5568' }}>
                Your AI thinking companion. Start a conversation to activate the neural workspace.
              </div>
            </div>
          )}
          {messages.map((msg, idx) => (
            <ChatMessage
              key={msg.id}
              msg={msg}
              accentColor={C.accent}
              borderColor={C.border}
              textColor={C.text}
              onSnap={msg.role === 'assistant' && !msg.streaming ? () => snapPrompt(idx) : null}
              snapCopied={snapCopied === idx}
            />
          ))}
          {/* Error banner */}
          {error && (
            <div className="mb-4">
              <div className="msg-appear flex flex-col gap-2 rounded-lg px-4 py-3 text-sm" style={{ background: '#2a0a0a', border: '1px solid #7f1d1d', color: '#fca5a5' }}>
                <div className="flex items-start gap-2">
                  <span>⚠</span>
                  <span className="flex-1">{error}</span>
                </div>
                <div className="mt-1 flex justify-end">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`I encountered this error:\n${error}\n\nPlease help me fix it.`);
                      setIsFixCopied(true);
                      setTimeout(() => setIsFixCopied(false), 3000);
                    }}
                    className="px-3 py-1.5 rounded-md text-xs font-medium transition-all hover:bg-[#7f1d1d22]"
                    style={{ border: '1px solid #7f1d1d', background: 'transparent' }}
                  >
                    {isFixCopied ? '✅ Copied! Now paste in Antigravity' : '📋 Copy & Fix'}
                  </button>
                </div>
              </div>
              <p className="text-[10px] mt-1 ml-1" style={{ color: '#666' }}>
                → Copy prompt → paste in Antigravity → done
              </p>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* ── Mode tabs + input area ── */}
        <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg }}>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: '0', padding: '0 16px', borderBottom: `1px solid ${C.border}` }}>
            {[{ id: 'think', label: '🧠 THINK' }, { id: 'forge', label: '⚡ FORGE' }].map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveMode(tab.id); if (tab.id === 'think') setForgeLabel('') }}
                style={{
                  padding: '8px 20px',
                  background: activeMode === tab.id ? `${C.accent}1a` : 'transparent',
                  border: 'none',
                  borderBottom: activeMode === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
                  color: activeMode === tab.id ? C.accent : '#4a5568',
                  fontSize: '11px', fontWeight: '700', letterSpacing: '3px',
                  cursor: 'pointer', textTransform: 'uppercase', transition: 'all 0.2s ease'
                }}
              >
                {tab.label}
              </button>
            ))}
            {/* Ready to Build */}
            {activeMode === 'think' && messages.length >= 2 && (
              <button
                onClick={readyToBuild}
                disabled={loading}
                style={{
                  marginLeft: 'auto', padding: '6px 16px', alignSelf: 'center',
                  background: `linear-gradient(135deg, ${C.glow}, rgba(251,191,36,0.1))`,
                  border: '1px solid rgba(251,191,36,0.3)', borderRadius: '8px',
                  color: '#fbbf24', fontSize: '11px', letterSpacing: '2px',
                  cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1
                }}
              >
                {loading ? '⏳ GENERATING...' : '🚀 READY TO BUILD'}
              </button>
            )}
          </div>

          {/* THINK mode input */}
          {activeMode === 'think' && (
            <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
              <textarea
                id="brain-dump-input"
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isGujaratiMode ? 'ZENI ને કંઈપણ કહો...' : 'Tell ZENI anything...'}
                style={{
                  flex: 1, background: `${C.accent}0d`, border: `1px solid ${C.border}`, borderRadius: '12px',
                  padding: '14px 16px', color: C.text, fontSize: '14px', resize: 'none', minHeight: '50px',
                  fontFamily: "'Space Grotesk', sans-serif", transition: 'all 0.3s ease', outline: 'none'
                }}
                onFocus={e => { e.target.style.border = `1px solid ${C.accent}80`; e.target.style.boxShadow = `0 0 20px ${C.glow}` }}
                onBlur={e => { e.target.style.border = `1px solid ${C.border}`; e.target.style.boxShadow = 'none' }}
              />
              <button
                onClick={() => setIsGujaratiMode(!isGujaratiMode)}
                title={isGujaratiMode ? 'Switch to English' : 'Switch to Gujarati'}
                style={{
                  width: '44px', height: '44px', borderRadius: '10px', background: `${C.accent}0d`,
                  border: `1px solid ${C.border}`, color: C.accent, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px'
                }}
              >
                {isGujaratiMode ? '🇮🇳' : '🌐'}
              </button>
              <button
                id="send-btn"
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                style={{
                  width: '44px', height: '44px', borderRadius: '10px',
                  background: `linear-gradient(135deg, ${C.accent}, ${C.accent}aa)`,
                  border: 'none', cursor: (loading || !input.trim()) ? 'not-allowed' : 'pointer',
                  boxShadow: `0 0 20px ${C.glow}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '16px', color: '#ffffff', opacity: (loading || !input.trim()) ? 0.5 : 1
                }}
              >
                {loading ? '…' : '➤'}
              </button>
            </div>
          )}

          {/* FORGE mode input */}
          {activeMode === 'forge' && (
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {forgeLabel && (
                <div style={{ fontSize: '10px', color: '#fbbf24', letterSpacing: '1px', padding: '4px 0' }}>{forgeLabel}</div>
              )}
              <textarea
                value={forgeContent}
                onChange={e => { setForgeContent(e.target.value); setForgeLabel('') }}
                placeholder="Write rough prompt — ZENI will perfect it"
                style={{
                  width: '100%', minHeight: '120px',
                  background: `${C.accent}0d`, border: `1px solid ${C.border}`,
                  borderRadius: '10px', padding: '12px',
                  color: C.text, fontSize: '13px',
                  fontFamily: "'Space Grotesk', sans-serif", resize: 'none', outline: 'none'
                }}
                onFocus={e => { e.target.style.border = `1px solid ${C.accent}80`; e.target.style.boxShadow = `0 0 20px ${C.glow}` }}
                onBlur={e => { e.target.style.border = `1px solid ${C.border}`; e.target.style.boxShadow = 'none' }}
              />
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={enhancePrompt}
                  disabled={loading || !forgeContent.trim()}
                  style={{
                    background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)',
                    borderRadius: '8px', padding: '8px 16px', color: '#fbbf24',
                    fontSize: '11px', letterSpacing: '2px',
                    cursor: (loading || !forgeContent.trim()) ? 'not-allowed' : 'pointer',
                    opacity: (loading || !forgeContent.trim()) ? 0.4 : 1
                  }}
                >
                  {loading ? '…' : '✨ ENHANCE'}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(forgeContent)
                    setPowerData(prev => {
                      const updated = { ...prev, promptsGenerated: prev.promptsGenerated + 1 }
                      localStorage.setItem('zeni_power', JSON.stringify(updated))
                      return updated
                    })
                    setForgeCopied(true)
                    setTimeout(() => setForgeCopied(false), 2000)
                  }}
                  disabled={!forgeContent.trim()}
                  style={{
                    background: forgeCopied ? 'rgba(16,185,129,0.15)' : `${C.accent}1a`,
                    border: forgeCopied ? '1px solid rgba(16,185,129,0.4)' : `1px solid ${C.accent}66`,
                    borderRadius: '8px', padding: '8px 20px',
                    color: forgeCopied ? '#10b981' : C.accent,
                    fontSize: '11px', letterSpacing: '2px',
                    cursor: !forgeContent.trim() ? 'not-allowed' : 'pointer',
                    opacity: !forgeContent.trim() ? 0.4 : 1, transition: 'all 0.2s ease'
                  }}
                >
                  {forgeCopied ? '✅ COPIED!' : '📋 COPY PROMPT'}
                </button>
              </div>
              <button
                onClick={sendMessage}
                disabled={loading || !forgeContent.trim()}
                style={{
                  width: '100%', padding: '10px', borderRadius: '8px',
                  background: `${C.accent}26`, border: `1px solid ${C.accent}4d`,
                  color: C.accent, fontSize: '12px', letterSpacing: '2px',
                  cursor: (loading || !forgeContent.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (loading || !forgeContent.trim()) ? 0.4 : 1
                }}
                onMouseOver={() => { if (forgeContent.trim() && !loading) setInput(forgeContent) }}
              >
                ➤ SEND TO ZENI
              </button>
            </div>
          )}

        </div>
      </main>


      {/* ── RIGHT PANEL ── */}
      <aside style={{ width: '300px', flexShrink: 0, background: C.panel, borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#ffffff', letterSpacing: '3px', textTransform: 'uppercase' }}>STRUCTURED OUTPUT</div>
          <div style={{ fontSize: '9px', color: C.accent, letterSpacing: '2px', marginTop: '2px', opacity: 0.6 }}>LIVE COGNITIVE MAP</div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '12px 0' }}>
          <StructuredSection label="Goals"      icon="◎" color={C.accent} borderColor={C.border} items={structured.goals} />
          <StructuredSection label="Tasks"      icon="☑" color={C.accent} borderColor={C.border} items={structured.tasks} />
          <StructuredSection label="Hypotheses" icon="◉" color={C.accent} borderColor={C.border} items={structured.hypotheses} />
          <StructuredSection label="Next Steps" icon="→" color={C.accent} borderColor={C.border} items={structured.nextSteps} />
        </div>

        {/* Copy as Prompt button */}
        <div style={{ position: 'relative' }}>
          {/* Toast */}
          <div
            id="copy-toast"
            className="absolute top-[-32px] left-5 right-5 text-center text-xs py-1 rounded-md transition-all duration-300"
            style={{ background: C.accent, color: '#fff', opacity: 0, pointerEvents: 'none', zIndex: 10 }}
          >
            ✓ Copied to clipboard!
          </div>

          <button
            id="copy-as-prompt-btn"
            onClick={copyAsPrompt}
            disabled={messages.length === 0}
            style={{
              margin: '12px', padding: '10px',
              background: `${C.accent}1a`, border: `1px solid ${C.accent}33`,
              borderRadius: '8px', cursor: messages.length === 0 ? 'not-allowed' : 'pointer',
              width: 'calc(100% - 24px)', fontSize: '11px', color: C.accent,
              letterSpacing: '1px', textAlign: 'center',
              opacity: messages.length === 0 ? 0.3 : 1, transition: 'all 0.2s ease'
            }}
          >
            ⎘ COPY AS PROMPT
          </button>
        </div>
      </aside>

      <AnimeBackgrounds />
    </div>
  )
}
