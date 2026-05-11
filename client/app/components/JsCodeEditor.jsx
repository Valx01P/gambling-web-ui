'use client'

import { useMemo, useRef, useState } from 'react'
import { CTX_GROUPS } from '../lib/ctxDocs'
import { lintJs } from '../lib/botCodeRunner'
import { STARTER_CODE } from '../lib/starterBotCode'


export { STARTER_CODE }

function DocsItem({ item, onInsert }) {
  return (
    <button
      type="button"
      onClick={() => onInsert(`ctx.${item.path}`)}
      className="block w-full rounded-md border border-zinc-700/70 bg-zinc-950/60 px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/80"
    >
      <div className="flex items-center justify-between gap-2">
        <code className="truncate text-[11px] font-bold text-emerald-300">ctx.{item.path}</code>
        <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-zinc-300">{item.type}</span>
      </div>
      {item.doc && (
        <div className="mt-0.5 text-[10px] font-bold leading-snug text-zinc-200">{item.doc}</div>
      )}
    </button>
  )
}

export default function JsCodeEditor({ code, onCodeChange }) {
  const taRef = useRef(null)
  const [filter, setFilter] = useState('')
  const [docsOpen, setDocsOpen] = useState(true)
  const [copied, setCopied] = useState(null)

  const lint = useMemo(() => lintJs(code), [code])

  function insertAtCursor(snippet) {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart ?? code.length
    const end = ta.selectionEnd ?? code.length
    const next = code.slice(0, start) + snippet + code.slice(end)
    onCodeChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + snippet.length
    })
  }

  function resetToTemplate() {
    if (!confirm('Replace your code with the starter template? Your current code will be lost.')) return
    onCodeChange(STARTER_CODE)
  }

  async function copyText(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    } catch {
      // Fallback for non-secure contexts: select+copy via a transient textarea.
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch {}
      ta.remove()
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    }
  }

  function buildCtxMarkdown() {
    const lines = ['# Bot ctx reference (paste this into your LLM)', '']
    for (const g of CTX_GROUPS) {
      lines.push(`## ${g.title}`)
      if (g.description) lines.push(g.description)
      for (const it of g.items) {
        const parts = [`- \`ctx.${it.path}\``, `(${it.type})`]
        if (it.doc) parts.push(`— ${it.doc}`)
        lines.push(parts.join(' '))
      }
      lines.push('')
    }
    lines.push('## Return contract', '- `{ action: "fold" }`', '- `{ action: "check" }`', '- `{ action: "call" }`', '- `{ action: "raise", amount: <total target bet, in chips> }`', '- `{ action: "all_in" }`', '- Any return may also include `say: "<phrase>"` (max 80 chars).')
    return lines.join('\n')
  }

  const filteredGroups = useMemo(() => {
    if (!filter.trim()) return CTX_GROUPS
    const needle = filter.toLowerCase()
    return CTX_GROUPS
      .map(g => ({
        ...g,
        items: g.items.filter(i =>
          i.path.toLowerCase().includes(needle) ||
          (i.doc || '').toLowerCase().includes(needle)
        )
      }))
      .filter(g => g.items.length > 0)
  }, [filter])

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
            bot.js — your decide(ctx) is the bot
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => copyText(code, 'code')}
              className="rounded-md border border-zinc-500/60 bg-zinc-800 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-100 hover:bg-zinc-700"
              title="Copy the entire bot.js source"
            >
              {copied === 'code' ? '✓ Copied' : 'Copy code'}
            </button>
            <button
              type="button"
              onClick={resetToTemplate}
              className="rounded-md border border-zinc-500/60 bg-zinc-800 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-100 hover:bg-zinc-700"
              title="Replace the editor contents with the starter template"
            >
              Reset to template
            </button>
            <span className={`text-[10px] font-black uppercase tracking-widest ${lint.ok ? 'text-emerald-300' : 'text-red-200'}`}>
              {lint.ok ? '✓ Parse OK' : '✗ Parse error'}
            </span>
          </div>
        </div>

        <div className="rounded-t-lg border border-b-0 border-zinc-700/70 bg-zinc-900/95 px-3 py-2 font-mono text-[11px]">
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-zinc-300">
            in scope when decide(ctx) runs
          </div>
          <div className="text-zinc-300 truncate">
            <span className="text-zinc-400">import </span>
            <span className="text-emerald-300">{'{ ctx }'}</span>
            <span className="text-zinc-400"> from </span>
            <span className="text-amber-300">{`'./game-state'`}</span>
            <span className="text-zinc-400"> // every signal listed in the right rail →</span>
          </div>
          <div className="text-zinc-300 truncate">
            <span className="text-zinc-400">import </span>
            <span className="text-emerald-300">{'{ handStrength, evaluateCards, randomFloat, console }'}</span>
            <span className="text-zinc-400"> from </span>
            <span className="text-amber-300">{`'./helpers'`}</span>
          </div>
        </div>

        <textarea
          ref={taRef}
          value={code}
          onChange={e => onCodeChange(e.target.value)}
          spellCheck={false}
          rows={32}
          className={`w-full resize-y rounded-b-lg border bg-zinc-950/90 p-3 font-mono text-[12px] leading-relaxed text-zinc-100 outline-none focus:border-zinc-300 ${lint.ok ? 'border-zinc-700/70' : 'border-red-500/60'}`}
        />

        {!lint.ok && (
          <div className="rounded-md border border-red-500/40 bg-red-500/15 px-2 py-1.5 text-xs font-bold text-red-100">
            {lint.error}
          </div>
        )}

        <div className="text-[11px] font-bold leading-snug text-zinc-300">
          Server runs <code className="text-emerald-300">decide(ctx)</code> on every turn with a 150 ms CPU budget,
          32 KB max source, no I/O. Return one of:
          {' '}<code className="text-zinc-100">{'{ action: "fold|check|call" }'}</code>,
          {' '}<code className="text-zinc-100">{'{ action: "raise", amount: <chips> }'}</code>,
          {' '}<code className="text-zinc-100">{'{ action: "all_in" }'}</code>.
          Add <code className="text-zinc-100">say: "..."</code> to yell at the table. Errors → bot folds.
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDocsOpen(o => !o)}
            className="flex flex-1 items-center justify-between rounded-md border border-zinc-500/60 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-700"
          >
            <span>Context reference</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
              {docsOpen ? 'Hide' : 'Show'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => copyText(buildCtxMarkdown(), 'ref')}
            className="rounded-md border border-zinc-500/60 bg-zinc-800 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-100 hover:bg-zinc-700"
            title="Copy every signal + helper as markdown — paste into an LLM"
          >
            {copied === 'ref' ? '✓' : 'Copy'}
          </button>
        </div>
        {docsOpen && (
          <>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter signals (e.g. opponent, pot)…"
              className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1.5 text-xs font-bold text-white outline-none placeholder:text-zinc-400 focus:border-zinc-300"
            />
            <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
              {filteredGroups.map(g => (
                <div key={g.title}>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-[11px] font-black uppercase tracking-widest text-emerald-200">{g.title}</div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">{g.items.length}</div>
                  </div>
                  {g.description && (
                    <div className="mb-1.5 text-[11px] font-bold text-zinc-300">{g.description}</div>
                  )}
                  <div className="space-y-1">
                    {g.items.map(it => (
                      <DocsItem key={it.path} item={it} onInsert={insertAtCursor} />
                    ))}
                  </div>
                </div>
              ))}
              {filteredGroups.length === 0 && (
                <div className="text-xs font-bold text-zinc-300">No fields match.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
