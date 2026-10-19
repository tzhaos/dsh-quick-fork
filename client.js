/**
 * Quick Fork — browser half of `dsh-quick-fork`.
 *
 * Selecting text in a conversation shows a small “复创” action. Clicking it
 * forks the current Session and opens a temporary conversation in the native
 * right sidebar. The tab owns its child Session only for this app run: closing
 * the tab archives the child, and the next app start closes any restored tab
 * before it can fork again.
 *
 * The panel is intentionally a compact side-chat surface: quote, transcript,
 * composer. It does not replace or clone the main conversation layout.
 *
 * @module dsh-quick-fork/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-quick-fork',
  factory(require) {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { createPortal } = require('react-dom')
    const { useEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    const NS = 'quickFork'
    const PLUGIN_ID = 'dsh-quick-fork'
    const KIND = 'quick-fork'
    const META_PREFIX = 'dsh.quickFork.tab.'
    const CHILD_KEY = 'dsh.quickFork.children'
    const RUN_ID = runIdForThisTab()
    const PAGE_RUN = randomId()

    const zh = {
      'tab.title': '复创',
      'bubble.label': '复创',
      'bubble.aria': '用选中内容开一个临时侧边对话',
      'panel.quote': '选中内容',
      'panel.placeholder': '针对这段内容继续提问…',
      'panel.send': '发送',
      'panel.stop': '停止',
      'panel.forking': '正在创建临时会话…',
      'panel.failed': '临时会话创建失败',
      'panel.empty': '还没有消息',
      'panel.expired': '临时会话已过期',
      'panel.close': '关闭',
      'panel.working': '运行中…',
      'guide.title': '临时侧聊',
      'guide.description': '不打断主线，针对选中内容追问',
    }
    const en = {
      'tab.title': 'Fork',
      'bubble.label': 'Fork',
      'bubble.aria': 'Open a temporary side conversation with the selected text',
      'panel.quote': 'Selected text',
      'panel.placeholder': 'Ask about this passage…',
      'panel.send': 'Send',
      'panel.stop': 'Stop',
      'panel.forking': 'Creating temporary conversation…',
      'panel.failed': 'Could not create the temporary conversation',
      'panel.empty': 'No messages yet',
      'panel.expired': 'This temporary conversation expired',
      'panel.close': 'Close',
      'panel.working': 'Running…',
      'guide.title': 'Side chat',
      'guide.description': 'Ask about a passage without interrupting the main thread',
    }

    /** Keep side tabs valid across a page reload, but not across an app restart. */
    function runIdForThisTab() {
      try {
        const key = 'dsh.quickFork.runId'
        const existing = sessionStorage.getItem(key)
        if (existing !== null && existing !== '') return existing
        const created = randomId()
        sessionStorage.setItem(key, created)
        return created
      } catch {
        return randomId()
      }
    }

    /** True when this module instance is a fresh page load after a restored tab. */
    function restoredPage() {
      try {
        const key = 'dsh.quickFork.pageRun'
        const previous = sessionStorage.getItem(key)
        if (previous === null || previous === '') {
          sessionStorage.setItem(key, PAGE_RUN)
          return false
        }
        return previous !== PAGE_RUN
      } catch {
        return false
      }
    }

    /** @returns {string} a collision-resistant local id. */
    function randomId() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      return String(Date.now()) + '-' + Math.random().toString(36).slice(2)
    }

    /** @param {unknown} value @returns {string} plain text from prompt blocks. */
    function textOfContent(value) {
      if (typeof value === 'string') return value
      if (!Array.isArray(value)) return ''
      const parts = []
      for (const block of value) {
        if (block === null || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
        else if (block.type === 'image') parts.push('[image]')
      }
      return parts.join('\n')
    }

    /**
     * Read one sidebar tab's params.
     * @param {unknown} params - navigation params.
     * @returns {{parentSessionId: string, quote: string}|null} parsed params.
     */
    function parseForkParams(params) {
      if (params === null || typeof params !== 'object') return null
      const parentSessionId = params.parentSessionId
      if (typeof parentSessionId !== 'string' || parentSessionId === '') return null
      return {
        parentSessionId,
        quote: typeof params.quote === 'string' ? params.quote : '',
      }
    }

    /**
     * Put the selected passage in front of the first prompt only.
     * @param {string} text - user's typed prompt.
     * @param {string} quote - selected passage.
     * @param {boolean} alreadySent - whether the quote was already sent.
     * @returns {string} prompt content for the first submission.
     */
    function composePrompt(text, quote, alreadySent) {
      if (alreadySent || typeof quote !== 'string' || quote.trim() === '') return text
      const quoted = quote.trim().split(/\r?\n/).map((line) => '> ' + line).join('\n')
      return quoted + '\n\n' + text
    }

    /**
     * Map durable conversation nodes into simple side-chat rows.
     * @param {unknown} snapshot - conversation chat snapshot or session snapshot.
     * @returns {Array<{key:string, role:string, text:string, error?:boolean}>} rows.
     */
    function nodesToMessages(snapshot, fromSeq = 0) {
      const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
      const rows = []
      for (const node of nodes) {
        if (node === null || typeof node !== 'object') continue
        const seq = typeof node.seq === 'number' ? node.seq : rows.length
        if (seq <= fromSeq) continue
        if (node.kind === 'user' || node.kind === 'steering') {
          const text = textOfContent(node.content)
          if (text !== '') rows.push({ key: 'u' + String(seq), role: 'user', text })
          continue
        }
        if (node.kind === 'assistant') {
          const blocks = Array.isArray(node.blocks) ? node.blocks : []
          const text = blocks
            .filter((block) => block !== null && typeof block === 'object' && block.kind === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('\n\n')
          if (text !== '') rows.push({ key: 'a' + String(seq), role: 'assistant', text })
          continue
        }
        if (node.kind === 'tool-result') {
          const text = textOfContent(node.content)
          if (text !== '') rows.push({ key: 't' + String(seq), role: 'tool', text, ...(node.isError === true ? { error: true } : {}) })
          continue
        }
        if (node.kind === 'turn-error') {
          rows.push({ key: 'e' + String(seq), role: 'error', text: typeof node.message === 'string' ? node.message : 'error' })
        }
      }
      return rows
    }

    /** @param {object} tab @returns {object} native tab type definition. */
    function tabDefinitionFor(t) {
      return {
        id: PLUGIN_ID,
        kind: KIND,
        multiple: true,
        title: () => t('tab.title'),
        guide: [{
          id: 'new',
          order: 40,
          title: () => t('guide.title'),
          description: () => t('guide.description'),
          icon: primitives.IconSparkleRegular,
        }],
      }
    }

    /** @param {unknown} id @returns {boolean} whether the id is a live child tracked this run. */
    function isTempChild(id) {
      if (typeof id !== 'string' || id === '') return false
      try {
        return (JSON.parse(localStorage.getItem(CHILD_KEY) ?? '[]')).includes(id)
      } catch {
        return false
      }
    }

    /** @param {string} id */
    function rememberChild(id) {
      try {
        const ids = JSON.parse(localStorage.getItem(CHILD_KEY) ?? '[]')
        if (!ids.includes(id)) localStorage.setItem(CHILD_KEY, JSON.stringify([...ids, id]))
      } catch {
        // Storage unavailable: the memory-only panel still works for this run.
      }
    }

    /** @param {string} id */
    function forgetChild(id) {
      try {
        const ids = JSON.parse(localStorage.getItem(CHILD_KEY) ?? '[]')
        localStorage.setItem(CHILD_KEY, JSON.stringify(ids.filter((entry) => entry !== id)))
      } catch {
        // ignore
      }
    }

    /** @param {string} tabId @returns {object|null} saved metadata. */
    function loadMeta(tabId) {
      try {
        const value = JSON.parse(localStorage.getItem(META_PREFIX + tabId) ?? 'null')
        return value !== null && typeof value === 'object' ? value : null
      } catch {
        return null
      }
    }

    /** @param {string} tabId @param {object} value */
    function saveMeta(tabId, value) {
      try { localStorage.setItem(META_PREFIX + tabId, JSON.stringify(value)) } catch { /* ignore */ }
    }

    /** @param {string} tabId */
    function dropMeta(tabId) {
      try { localStorage.removeItem(META_PREFIX + tabId) } catch { /* ignore */ }
    }

    /** @returns {string} the on-screen main conversation id, or ''. */
    function currentSessionIdOf() {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return ''
      for (const node of document.querySelectorAll('[data-conversation-session]')) {
        if (node.closest?.('[hidden], [aria-hidden="true"]') !== null) continue
        const id = node.getAttribute?.('data-conversation-session') ?? ''
        if (id !== '') return id
      }
      return ''
    }

    /** @param {unknown} target @returns {boolean} whether the target sits inside our panel. */
    function insideQuickForkPanel(target) {
      if (target === null || target === undefined || typeof target.closest !== 'function') return false
      return target.closest('[data-dsh-quick-fork-panel]') !== null
    }

    /** @param {object} options @returns {boolean} */
    function canOfferFork(options) {
      return typeof options.text === 'string' && options.text.trim() !== ''
        && typeof options.parentSessionId === 'string' && options.parentSessionId !== ''
        && options.inPanel !== true
        && isTempChild(options.parentSessionId) !== true
    }

    /** Get the UI conversation chat target for a binding, if the host exposes it. */
    function chatTargetOf(ctx, binding) {
      try {
        const ui = ctx.get('uiConversation')
        const target = ui?.binding?.(binding)?.target?.('chat')
        return target !== null && target !== undefined && typeof target.getSnapshot === 'function' ? target : null
      } catch {
        return null
      }
    }

    /** @param {object} ctx @param {object} binding @returns {object|null} chat snapshot. */
    function chatSnapshotOf(ctx, binding) {
      const target = chatTargetOf(ctx, binding)
      if (target !== null) {
        const snap = target.getSnapshot()
        return snap?.legacy ?? snap ?? null
      }
      try {
        return binding.session.getSnapshot()
      } catch {
        return null
      }
    }

    /** @param {unknown} snapshot @returns {number} highest durable seq. */
    function maxSeqOf(snapshot) {
      const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
      let max = 0
      for (const node of nodes) {
        if (node !== null && typeof node === 'object' && typeof node.seq === 'number' && node.seq > max) max = node.seq
      }
      return max
    }

    /**
     * Build the selection action layer.
     * @param {object} ctx - root client context.
     * @returns {Function} React component.
     */
    function createSelectionLayer(ctx) {
      return function SelectionLayer() {
        const [bubble, setBubble] = useState(null)
        const bubbleRef = useRef(null)
        bubbleRef.current = bubble
        useEffect(() => {
          const clear = () => setBubble(null)
          const update = () => {
            try {
              const selection = window.getSelection?.()
              const text = typeof selection?.toString === 'function' ? selection.toString().trim() : ''
              if (text === '' || selection.rangeCount === 0) {
                clear()
                return
              }
              const anchor = selection.anchorNode
              const element = anchor?.nodeType === 3 ? anchor.parentElement : anchor
              if (insideQuickForkPanel(element)) {
                clear()
                return
              }
              const parentSessionId = currentSessionIdOf()
              if (!canOfferFork({ text, parentSessionId, inPanel: false })) {
                clear()
                return
              }
              const rect = selection.getRangeAt(0).getBoundingClientRect()
              if (rect.width < 1 || rect.height < 1) {
                clear()
                return
              }
              setBubble({ text: text.slice(0, 2000), x: rect.left + rect.width / 2, y: rect.top, parentSessionId })
            } catch {
              clear()
            }
          }
          document.addEventListener('selectionchange', update)
          document.addEventListener('mouseup', update)
          document.addEventListener('keyup', update)
          window.addEventListener('scroll', clear, true)
          window.addEventListener('resize', clear)
          return () => {
            document.removeEventListener('selectionchange', update)
            document.removeEventListener('mouseup', update)
            document.removeEventListener('keyup', update)
            window.removeEventListener('scroll', clear, true)
            window.removeEventListener('resize', clear)
          }
        }, [])
        if (bubble === null) return null
        const open = () => {
          const sidebar = ctx.get('sidebarRight')
          if (sidebar === null || sidebar === undefined || typeof sidebar.openTab !== 'function') {
            setBubble(null)
            return
          }
          sidebar.openTab(KIND, {
            params: { parentSessionId: bubble.parentSessionId, quote: bubble.text },
          })
          setBubble(null)
        }
        return createPortal(h('button', {
          type: 'button',
          className: 'dshqf-bubble',
          'data-dsh-quick-fork-bubble': '',
          'aria-label': tRef(ctx, 'bubble.aria'),
          title: tRef(ctx, 'bubble.aria'),
          style: {
            left: Math.max(12, bubble.x) + 'px',
            top: Math.max(12, bubble.y - 36) + 'px',
          },
          onMouseDown: (event) => { event.preventDefault?.() },
          onClick: open,
        }, h('span', { className: 'dshqf-bubbleMark', 'aria-hidden': true }, '⑂'), h('span', null, tRef(ctx, 'bubble.label'))), document.body)
      }
    }

    /** Resolve copy without requiring a React locale hook inside event-only code. */
    function tRef(ctx, key) {
      try {
        return ctx.locale.bind(NS)(key)
      } catch {
        return key
      }
    }

    /**
     * Build the side-fork body.
     * @param {object} ctx - root client context.
     * @returns {Function} React component.
     */
    function createPanel(ctx) {
      return function SideForkPanel({ useTabInfo }) {
        const info = typeof useTabInfo === 'function' ? useTabInfo() : null
        const tab = info?.tab
        const tabId = typeof tab?.id === 'string' ? tab.id : ''
        const params = useMemo(() => parseForkParams(tab?.navigation?.params), [tab?.navigation?.params])
        const effective = useMemo(() => params ?? { parentSessionId: currentSessionIdOf(), quote: '' }, [params, tabId])
        const [childId, setChildId] = useState(null)
        const [binding, setBinding] = useState(null)
        const [messages, setMessages] = useState([])
        const [running, setRunning] = useState(false)
        const [draft, setDraft] = useState('')
        const [error, setError] = useState('')
        const [sending, setSending] = useState(false)
        const [expired, setExpired] = useState(false)
        const quoteSentRef = useRef(false)
        const baselineRef = useRef(0)
        const inputRef = useRef(null)
        const logRef = useRef(null)

        // Fork once per tab. A tab restored after the app restarted has no
        // matching run marker: it is expired and must not create another child.
        useEffect(() => {
          let cancelled = false
          const pageRestored = restoredPage()
          if (pageRestored) {
            setExpired(true)
            setError(tRef(ctx, 'panel.expired'))
            if (tabId !== '') dropMeta(tabId)
            try { tab?.actions?.close?.() } catch { /* ignore */ }
            return undefined
          }
          if (tabId === '' || effective.parentSessionId === '') {
            setError(tRef(ctx, 'panel.failed'))
            return undefined
          }
          const meta = loadMeta(tabId)
          if (meta !== null) {
            quoteSentRef.current = meta.quoteSent === true
            baselineRef.current = typeof meta.baselineSeq === 'number' ? meta.baselineSeq : 0
          }
          if (meta !== null && meta.runId !== RUN_ID) {
            setExpired(true)
            setError(tRef(ctx, 'panel.expired'))
            try { tab?.actions?.close?.() } catch { /* ignore */ }
            return undefined
          }
          if (meta !== null && typeof meta.childId === 'string' && meta.runId === RUN_ID) {
            setChildId(meta.childId)
            return undefined
          }
          void (async () => {
            try {
              let baselineSeq = 0
              let child
              if (typeof ctx.sessions?.create === 'function') {
                let cwd
                try {
                  cwd = ctx.sessions.list?.getSnapshot?.()?.byId?.[effective.parentSessionId]?.cwd
                } catch { cwd = undefined }
                child = await ctx.sessions.create(typeof cwd === 'string' && cwd !== '' ? { cwd } : {})
              } else if (typeof ctx.sessions?.fork === 'function') {
                child = await ctx.sessions.fork({ sessionId: effective.parentSessionId })
              } else {
                throw new Error('session create unavailable')
              }
              if (cancelled) return
              if (typeof child !== 'string' || child === '') throw new Error('fork returned no session')
              baselineRef.current = baselineSeq
              saveMeta(tabId, { childId: child, runId: RUN_ID, parentSessionId: effective.parentSessionId, baselineSeq })
              rememberChild(child)
              setChildId(child)
            } catch (forkError) {
              if (!cancelled) setError(tRef(ctx, 'panel.failed') + ': ' + String(forkError?.message ?? forkError))
            }
          })()
          return () => { cancelled = true }
        }, [effective, tabId])

        // Adopt the child binding and its durable conversation face.
        useEffect(() => {
          if (childId === null) return undefined
          let disposed = false
          let retained
          void (async () => {
            try {
              let next
              try {
                retained = typeof ctx.sessions.retain === 'function'
                  ? ctx.sessions.retain(childId, { source: 'dsh-quick-fork' })
                  : undefined
                next = retained !== undefined ? await retained.ready : undefined
              } catch {
                retained = undefined
              }
              if (next === null || next === undefined) {
                next = ctx.sessions.binding(childId)
              }
              if (next === null || next === undefined) {
                try { await ctx.get('workspaces')?.unarchiveSession?.(childId) } catch { /* not archived */ }
                next = ctx.sessions.binding(childId)
              }
              if (disposed || next === null || next === undefined) {
                if (!disposed) setError(tRef(ctx, 'panel.expired'))
                return
              }
              try { await next.session.open?.() } catch { /* already opening */ }
              if (!disposed) setBinding(next)
            } catch (bindingError) {
              if (!disposed) setError(tRef(ctx, 'panel.failed') + ': ' + String(bindingError?.message ?? bindingError))
            }
          })()
          return () => {
            disposed = true
            try { retained?.release?.() } catch { /* ignore */ }
          }
        }, [childId])

        useEffect(() => {
          if (binding === null) return undefined
          let disposed = false
          const update = () => {
            if (disposed) return
            setMessages(nodesToMessages(chatSnapshotOf(ctx, binding), baselineRef.current))
            try { setRunning(binding.session.getSnapshot()?.running === true) } catch { /* ignore */ }
          }
          update()
          const offs = []
          const target = chatTargetOf(ctx, binding)
          if (target !== null && typeof target.subscribe === 'function') offs.push(target.subscribe(update))
          if (typeof binding.session.subscribe === 'function') offs.push(binding.session.subscribe(update))
          return () => {
            disposed = true
            for (const off of offs) { try { off() } catch { /* ignore */ } }
          }
        }, [binding])

        useEffect(() => {
          if (binding === null) return
          inputRef.current?.focus?.()
        }, [binding])

        useEffect(() => {
          const log = logRef.current
          if (log !== null && log !== undefined) log.scrollTop = log.scrollHeight
        }, [messages.length, running])

        const submit = async () => {
          const text = draft.trim()
          if (text === '' || sending || binding === null) return
          setSending(true)
          setError('')
          const promptText = composePrompt(text, effective.quote ?? '', quoteSentRef.current)
          try {
            const session = binding.session
            const submission = typeof session.beginSubmission === 'function'
              ? session.beginSubmission({ mode: 'queue', text: promptText, attachments: [] })
              : undefined
            const result = await session.prompt([{ type: 'text', text: promptText }], 'queue', undefined, submission?.requestId)
            if (result?.ok !== true) {
              try { submission?.abandon?.() } catch { /* ignore */ }
              setError(tRef(ctx, 'panel.failed'))
            } else {
              setDraft('')
              if ((effective.quote ?? '') !== '') {
                quoteSentRef.current = true
                saveMeta(tabId, { ...(loadMeta(tabId) ?? {}), quoteSent: true })
              }
            }
          } catch (sendError) {
            setError(String(sendError?.message ?? sendError))
          } finally {
            setSending(false)
          }
        }

        const quote = effective.quote ?? ''
        const status = expired
          ? h('div', { className: 'dshqf-state' }, tRef(ctx, 'panel.expired'))
          : null
        const forking = !expired && childId === null && error === ''
          ? h('div', { className: 'dshqf-state' }, tRef(ctx, 'panel.forking'))
          : null
        const quoteBox = quote === ''
          ? null
          : h('div', { className: 'dshqf-quote' },
            h('div', { className: 'dshqf-quoteLabel' }, tRef(ctx, 'panel.quote')),
            h('div', { className: 'dshqf-quoteText' }, quote))
        const empty = messages.length === 0 && childId !== null && error === ''
          ? h('div', { className: 'dshqf-empty' }, tRef(ctx, 'panel.empty'))
          : null
        const rows = messages.map((message) => h('div', {
          key: message.key,
          className: 'dshqf-msg dshqf-' + message.role + (message.error ? ' dshqf-error' : ''),
        }, message.role === 'tool'
          ? h('details', { className: 'dshqf-toolBlock' },
            h('summary', { className: 'dshqf-role' }, 'TOOL'),
            h('pre', { className: 'dshqf-toolText' }, message.text))
          : h(React.Fragment, null,
            h('div', { className: 'dshqf-role' }, message.role === 'assistant' ? 'DSH' : message.role),
            message.role === 'assistant'
              ? h(primitives.MarkdownText, { text: message.text, streaming: running })
              : h('div', { className: 'dshqf-text' }, message.text))))
        const log = h('div', { ref: logRef, className: 'dshqf-log' }, empty, rows)
        const errorBox = error !== '' ? h('div', { className: 'dshqf-errorText' }, error) : null
        const actions = h('div', { className: 'dshqf-actions' },
          running ? h('span', { className: 'dshqf-status' }, tRef(ctx, 'panel.working')) : null,
          running && typeof binding?.session?.cancel === 'function'
            ? h('button', { type: 'button', className: 'dshqf-secondary', onClick: () => { void binding.session.cancel() } }, tRef(ctx, 'panel.stop'))
            : null,
          h('button', { type: 'button', className: 'dshqf-send', disabled: sending || draft.trim() === '', onClick: () => { void submit() } }, tRef(ctx, 'panel.send')))
        const composer = h('div', { className: 'dshqf-composer' },
          h('textarea', {
            ref: inputRef,
            className: 'dshqf-input',
            rows: 2,
            value: draft,
            placeholder: tRef(ctx, 'panel.placeholder'),
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault?.()
                void submit()
              }
            },
          }),
          actions)
        return h('div', { className: 'dshqf-panel', 'data-dsh-quick-fork-panel': '' },
          status, forking, quoteBox, log, errorBox, composer)
      }
    }

    /** Small stylesheet. */
    const CSS = `
.dshqf-bubble{position:fixed;z-index:120;transform:translateX(-50%);display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-soft);font:inherit;font-size:12px;cursor:pointer}
.dshqf-bubble:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshqf-bubbleMark{font-size:14px}
.dshqf-panel{display:flex;flex-direction:column;gap:10px;height:100%;min-height:0;padding:10px;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px}
.dshqf-state,.dshqf-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:8px 2px}
.dshqf-quote{border-left:2px solid var(--dsw-alias-state-business-primary);padding:6px 8px;background:var(--dsw-alias-interactive-bg-hover);border-radius:6px}
.dshqf-quoteLabel{font-size:10px;font-weight:600;color:var(--dsw-alias-label-tertiary);margin-bottom:3px}
.dshqf-quoteText{white-space:pre-wrap;max-height:90px;overflow:auto;color:var(--dsw-alias-label-secondary)}
.dshqf-log{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;padding-right:2px}
.dshqf-msg{border-radius:8px;padding:7px 8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}
.dshqf-user{background:var(--dsw-alias-interactive-bg-hover)}
.dshqf-tool,.dshqf-error{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family-mono,monospace);font-size:11px}
.dshqf-role{font-size:9px;font-weight:700;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;margin-bottom:3px}
.dshqf-text{white-space:pre-wrap;overflow-wrap:anywhere}
.dshqf-toolBlock summary{cursor:pointer;list-style:none}
.dshqf-toolBlock summary::-webkit-details-marker{display:none}
.dshqf-toolBlock summary:before{content:'▸ ';color:var(--dsw-alias-label-tertiary)}
.dshqf-toolBlock[open] summary:before{content:'▾ '}
.dshqf-toolText{margin:4px 0 0;max-height:160px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--dsw-font-family-mono,monospace);font-size:11px}
.dshqf-errorText{color:var(--dsw-alias-state-warning-primary);font-size:11px}
.dshqf-composer{display:flex;flex-direction:column;gap:6px}
.dshqf-input{width:100%;box-sizing:border-box;resize:vertical;min-height:54px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}
.dshqf-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dshqf-status{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-right:auto}
.dshqf-send,.dshqf-secondary{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 10px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-inverse,#fff);font:inherit;cursor:pointer}
.dshqf-send:disabled{opacity:.4;cursor:default}
.dshqf-secondary{background:transparent;color:var(--dsw-alias-label-secondary)}
`

    /**
     * Register the plugin.
     * @param {object} ctx - client root context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quick-fork: dictionaries')
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {}
        const style = document.createElement('style')
        style.dataset.dshPlugin = PLUGIN_ID
        style.textContent = CSS
        document.head.appendChild(style)
        return () => { style.remove?.() }
      }, 'quick-fork: styles')

      const SelectionLayer = createSelectionLayer(ctx)
      const Panel = createPanel(ctx)
      const tabDefinition = tabDefinitionFor((key) => {
        try { return ctx.locale.bind(NS)(key) } catch { return key }
      })

      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'quick-fork.selection',
      }, SelectionLayer)), 'quick-fork: selection bubble')

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: PLUGIN_ID,
      }, Panel)), 'quick-fork: panel body')

      ctx.inject(['sidebarRightTabs'], (tabCtx) => {
        tabCtx.effect(() => tabCtx.sidebarRightTabs.register(tabDefinition), 'quick-fork: tab type')
      })

      ctx.inject(['sidebarRight'], (sideCtx) => {
        sideCtx.effect(() => sideCtx.sidebarRight.registerCloseHandler(KIND, (_sessionId, tab) => {
          const meta = loadMeta(tab.id)
          if (meta !== null && typeof meta.childId === 'string') {
            forgetChild(meta.childId)
            try { void sideCtx.get('workspaces')?.archiveSession?.(meta.childId) } catch { /* ignore */ }
          }
          dropMeta(tab.id)
        }), 'quick-fork: close cleanup')
      })
    }

    return {
      inject: ['sessions', 'slots', 'locale'],
      apply,
      __test: { parseForkParams, nodesToMessages, tabDefinitionFor, canOfferFork, composePrompt, maxSeqOf },
    }
  },
})
