/**
 * Quick Fork — browser half of `dsh-quick-fork`.
 *
 * Selecting text in a conversation shows a compact two-segment capsule above
 * the selection. “Add to chat” attaches the passage to the composer as a
 * numbered annotation chip (hovering the chip shows the full text) and carries
 * the annotations as leading context on the next prompt; “Ask in side chat”
 * opens a temporary conversation in the native right sidebar. The tab owns its
 * child Session only for this app run: closing the tab archives the child, and
 * the next app start closes any restored tab before it can fork again.
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
    const { useEffect, useLayoutEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    const NS = 'quickFork'
    const PLUGIN_ID = 'dsh-quick-fork'
    const KIND = 'quick-fork'
    const META_PREFIX = 'dsh.quickFork.tab.'
    const CHILD_KEY = 'dsh.quickFork.children'
    const ANNOTATION_STORE_KEY = 'dsh.quickFork.annotations'
    const ANNOTATION_MAX_COUNT = 20
    const ANNOTATION_MAX_TEXT = 20000
    const ANNOTATION_EMPTY = Object.freeze([])
    const RUN_ID = runIdForThisTab()
    const PAGE_RUN = randomId()

    const zh = {
      'tab.title': '临时对话',
      'bubble.aria': '选中文字操作',
      'bubble.addToChat': '添加到对话',
      'bubble.addToChatAria': '把选中内容作为注释添加到当前对话',
      'bubble.addToTempChat': '添加到临时对话',
      'bubble.addToTempChatAria': '用选中内容开一个临时侧边对话',
      'bubble.addFailed': '当前对话暂时无法添加注释',
      'annotation.label': '注释',
      'annotation.panelTitle': '选中内容',
      'annotation.remove': '移除注释',
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
      'tab.title': 'Side chat',
      'bubble.aria': 'Selection actions',
      'bubble.addToChat': 'Add to chat',
      'bubble.addToChatAria': 'Add the selected text to this conversation as an annotation',
      'bubble.addToTempChat': 'Ask in side chat',
      'bubble.addToTempChatAria': 'Open a temporary side conversation with the selected text',
      'bubble.addFailed': 'This conversation cannot take an annotation right now',
      'annotation.label': 'annotation',
      'annotation.panelTitle': 'Selected text',
      'annotation.remove': 'Remove annotation',
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
     * Format a selected passage as a Markdown blockquote.
     * @param {string} text - selected plain text.
     * @returns {string} quoted Markdown, or an empty string.
     */
    function quoteBlockOf(text) {
      if (typeof text !== 'string') return ''
      const trimmed = text.trim()
      if (trimmed === '') return ''
      return trimmed.split(/\r?\n/).map((line) => '> ' + line).join('\n')
    }

    /**
     * Put the selected passage in front of the first prompt only.
     * @param {string} text - user's typed prompt.
     * @param {string} quote - selected passage.
     * @param {boolean} alreadySent - whether the quote was already sent.
     * @returns {string} prompt content for the first submission.
     */
    function composePrompt(text, quote, alreadySent) {
      if (alreadySent) return text
      const quoted = quoteBlockOf(quote)
      if (quoted === '') return text
      return quoted + '\n\n' + text
    }

    /**
     * Resolve the live composer shell of a Session, if the host exposes it.
     * @param {object} ctx - root client context.
     * @param {string} sessionId - owning Session id.
     * @returns {object|null} input shell, or null when the Session has no live scope.
     */
    function inputShellOf(ctx, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return null
      try {
        const sessions = ctx.sessions
        if (sessions === null || sessions === undefined || typeof sessions.scope !== 'function') return null
        const scope = sessions.scope(sessionId)
        if (scope === null || scope === undefined || typeof scope.get !== 'function') return null
        const conversation = scope.get('conversation')
        const shell = conversation?.input?.for?.(scope)
        return shell !== null && shell !== undefined ? shell : null
      } catch {
        return null
      }
    }

    /** Annotation lists by Session id (browser-local draft context, persisted). */
    const annotationBySession = loadAnnotationStore()
    const annotationListeners = new Set()
    const wrappedPrompts = new WeakSet()

    /** @returns {Map<string, Array<{id:string,text:string}>>} persisted annotation lists. */
    function loadAnnotationStore() {
      const store = new Map()
      try {
        if (typeof localStorage === 'undefined') return store
        const raw = JSON.parse(localStorage.getItem(ANNOTATION_STORE_KEY) ?? 'null')
        if (raw === null || typeof raw !== 'object') return store
        for (const [sessionId, items] of Object.entries(raw)) {
          if (typeof sessionId !== 'string' || !Array.isArray(items)) continue
          const list = items
            .filter((item) => item !== null && typeof item === 'object' && typeof item.text === 'string' && item.text.trim() !== '')
            .slice(0, ANNOTATION_MAX_COUNT)
            .map((item) => ({
              id: typeof item.id === 'string' && item.id !== '' ? item.id : randomId(),
              text: item.text.slice(0, ANNOTATION_MAX_TEXT),
            }))
          if (list.length > 0) store.set(sessionId, list)
        }
      } catch {
        return new Map()
      }
      return store
    }

    /** Persist the current annotation lists; storage failures keep the in-page copy. */
    function saveAnnotationStore() {
      try {
        if (typeof localStorage === 'undefined') return
        const raw = {}
        for (const [sessionId, items] of annotationBySession) if (items.length > 0) raw[sessionId] = items
        if (Object.keys(raw).length === 0) localStorage.removeItem(ANNOTATION_STORE_KEY)
        else localStorage.setItem(ANNOTATION_STORE_KEY, JSON.stringify(raw))
      } catch {
        // Storage unavailable: annotations still work for this page.
      }
    }

    /** Notify every mounted annotation layer. */
    function notifyAnnotations() {
      for (const listener of [...annotationListeners]) {
        try {
          listener()
        } catch {
          // One bad listener must not stop the rest.
        }
      }
    }

    /** @param {() => void} listener @returns {() => void} unsubscribe. */
    function subscribeAnnotations(listener) {
      annotationListeners.add(listener)
      return () => {
        annotationListeners.delete(listener)
      }
    }

    /** @param {string} sessionId @returns {Array<{id:string,text:string}>} current list. */
    function annotationItemsOf(sessionId) {
      return annotationBySession.get(sessionId) ?? ANNOTATION_EMPTY
    }

    /** @param {string} sessionId @param {string} text @returns {boolean} whether it was added. */
    function addAnnotation(sessionId, text) {
      if (typeof sessionId !== 'string' || sessionId === '' || typeof text !== 'string') return false
      const trimmed = text.trim()
      if (trimmed === '') return false
      const items = annotationItemsOf(sessionId)
      if (items.length >= ANNOTATION_MAX_COUNT) return false
      annotationBySession.set(sessionId, [...items, { id: randomId(), text: trimmed.slice(0, ANNOTATION_MAX_TEXT) }])
      saveAnnotationStore()
      notifyAnnotations()
      return true
    }

    /** @param {string} sessionId @param {string} id @returns {boolean} whether it was removed. */
    function removeAnnotation(sessionId, id) {
      const items = annotationItemsOf(sessionId)
      const next = items.filter((item) => item.id !== id)
      if (next.length === items.length) return false
      if (next.length === 0) annotationBySession.delete(sessionId)
      else annotationBySession.set(sessionId, next)
      saveAnnotationStore()
      notifyAnnotations()
      return true
    }

    /** @param {string} sessionId @param {Array<{id:string,text:string}>} items - annotations to drop. */
    function forgetAnnotations(sessionId, items) {
      if (items.length === 0) return
      const ids = new Set(items.map((item) => item.id))
      const next = annotationItemsOf(sessionId).filter((item) => !ids.has(item.id))
      if (next.length === 0) annotationBySession.delete(sessionId)
      else annotationBySession.set(sessionId, next)
      saveAnnotationStore()
      notifyAnnotations()
    }

    /** @param {string} sessionId @param {Array<{id:string,text:string}>} items - annotations to put back. */
    function restoreAnnotations(sessionId, items) {
      if (items.length === 0) return
      const current = annotationItemsOf(sessionId)
      const known = new Set(current.map((item) => item.id))
      const missing = items.filter((item) => !known.has(item.id))
      if (missing.length === 0) return
      annotationBySession.set(sessionId, [...missing, ...current].slice(0, ANNOTATION_MAX_COUNT))
      saveAnnotationStore()
      notifyAnnotations()
    }

    /**
     * Model-facing context for one submission: numbered selected passages.
     * @param {Array<{text:string}>} items - annotations in display order.
     * @returns {string} context text, or '' when nothing can be sent.
     */
    function annotationContextOf(items) {
      if (!Array.isArray(items) || items.length === 0) return ''
      return items
        .filter((item) => item !== null && typeof item === 'object' && typeof item.text === 'string' && item.text.trim() !== '')
        .map((item, index) => 'Selected text ' + String(index + 1) + ':\n' + item.text.trim())
        .join('\n\n')
    }

    /**
     * Wrap one Session's prompt so pending annotations travel as a leading text
     * block. Annotations leave the draft when the send starts; a rejected prompt
     * puts the same annotations back in their original order.
     * @param {object} ctx - root client context.
     * @param {string} sessionId - owning Session id.
     */
    function ensureAnnotationPromptWrapper(ctx, sessionId) {
      try {
        const binding = ctx.sessions?.binding?.(sessionId)
        const session = binding?.session
        if (session === null || session === undefined || typeof session.prompt !== 'function') return
        if (wrappedPrompts.has(session)) return
        const original = session.prompt
        const patched = async function promptWithAnnotations(content, mode, signal, requestId) {
          const pending = annotationItemsOf(sessionId).slice()
          const context = pending.length === 0 ? '' : annotationContextOf(pending)
          if (context === '' || !Array.isArray(content)) return original.call(this, content, mode, signal, requestId)
          forgetAnnotations(sessionId, pending)
          let result
          try {
            result = await original.call(this, [{ type: 'text', text: context }, ...content], mode, signal, requestId)
          } catch (error) {
            restoreAnnotations(sessionId, pending)
            throw error
          }
          if (result === null || result === undefined || result.ok !== true) restoreAnnotations(sessionId, pending)
          return result
        }
        session.prompt = patched
        wrappedPrompts.add(session)
      } catch {
        // Wrapping is best effort; annotations still show even without submission context.
      }
    }

    /**
     * Find or create the annotation row host directly above one composer editor.
     * @param {Element} card - `[data-composer-card]` element.
     * @returns {Element} the host element.
     */
    function ensureAnnotationHost(card) {
      let host = null
      for (const child of card.children) {
        if (child?.getAttribute?.('data-dsh-quick-fork-annotations') !== null) {
          host = child
          break
        }
      }
      if (host === null) {
        host = document.createElement('div')
        host.setAttribute('data-dsh-quick-fork-annotations', '')
        host.className = 'dshqf-annotations'
        host.style.display = 'none'
      }
      const editor = card.querySelector(':scope > [data-input-scroll]')
      if (editor !== null && editor.parentElement === card) {
        if (host.parentElement !== card || host.nextElementSibling !== editor) card.insertBefore(host, editor)
      } else if (host.parentElement !== card) {
        card.appendChild(host)
      }
      return host
    }

    /**
     * Build the composer annotation layer: numbered chips inside the composer
     * card, each with a hover panel that shows the full selected passage.
     * @param {object} ctx - root client context.
     * @returns {Function} React component registered into the composer overlay.
     */
    function createAnnotationChips(ctx) {
      return function AnnotationChipLayer({ sessionId, t }) {
        const [marker, setMarker] = useState(null)
        const [host, setHost] = useState(null)
        const [items, setItems] = useState(() => annotationItemsOf(sessionId))
        const [hover, setHover] = useState(null)
        const [panelPosition, setPanelPosition] = useState(null)
        const hoverTimerRef = useRef(null)
        const panelRef = useRef(null)

        useEffect(() => {
          setItems(annotationItemsOf(sessionId))
          return subscribeAnnotations(() => setItems(annotationItemsOf(sessionId)))
        }, [sessionId])

        useEffect(() => {
          ensureAnnotationPromptWrapper(ctx, sessionId)
        }, [sessionId])

        useEffect(() => {
          if (marker === null) {
            setHost(null)
            return undefined
          }
          const card = typeof marker.closest === 'function' ? marker.closest('[data-composer-card]') : null
          if (card === null) {
            setHost(null)
            return undefined
          }
          const target = ensureAnnotationHost(card)
          setHost(target)
          let observer
          if (typeof MutationObserver === 'function') {
            observer = new MutationObserver(() => {
              if (card.contains(target) && target.parentElement === card) return
              setHost(ensureAnnotationHost(card))
            })
            observer.observe(card, { childList: true })
          }
          return () => {
            observer?.disconnect?.()
            target.remove?.()
          }
        }, [marker, sessionId])

        useEffect(() => {
          if (host === null) return
          host.style.display = items.length === 0 ? 'none' : 'flex'
        }, [host, items.length])

        useEffect(() => () => {
          if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
        }, [])

        // Measure the hover panel before painting so it never flashes at a stale spot.
        useLayoutEffect(() => {
          if (hover === null || panelRef.current === null) {
            setPanelPosition(null)
            return
          }
          const rect = panelRef.current.getBoundingClientRect()
          const viewport = typeof window.innerWidth === 'number' ? window.innerWidth : 0
          const left = Math.min(Math.max(8, hover.x - rect.width / 2), Math.max(8, viewport - rect.width - 8))
          const above = hover.y - rect.height - 8
          const top = above >= 8 ? above : hover.y + hover.height + 8
          setPanelPosition({ left, top })
        }, [hover])

        const cancelHide = () => {
          if (hoverTimerRef.current === null) return
          clearTimeout(hoverTimerRef.current)
          hoverTimerRef.current = null
        }
        const scheduleHide = () => {
          cancelHide()
          hoverTimerRef.current = setTimeout(() => {
            hoverTimerRef.current = null
            setHover(null)
          }, 180)
        }
        const showHover = (item, element) => {
          if (typeof element?.getBoundingClientRect !== 'function') return
          cancelHide()
          const rect = element.getBoundingClientRect()
          setHover({ id: item.id, x: rect.left + rect.width / 2, y: rect.top, height: rect.height })
        }

        const hoveredIndex = hover === null ? -1 : items.findIndex((item) => item.id === hover.id)
        const hoveredItem = hoveredIndex >= 0 ? items[hoveredIndex] : null
        const hoverPanel = hoveredItem === null ? null : createPortal(h('div', {
          ref: panelRef,
          className: 'dshqf-annotationPanel',
          role: 'tooltip',
          style: panelPosition === null
            ? { left: '-9999px', top: '-9999px' }
            : { left: panelPosition.left + 'px', top: panelPosition.top + 'px' },
          onMouseEnter: cancelHide,
          onMouseLeave: scheduleHide,
        },
          h('div', { className: 'dshqf-annotationPanelTitle' }, String(hoveredIndex + 1) + '. ' + t('annotation.panelTitle')),
          h('div', { className: 'dshqf-annotationPanelText' }, hoveredItem.text)), document.body)
        const row = h('div', { className: 'dshqf-annotationRow', role: 'list' },
          items.map((item, index) => h('span', {
            key: item.id,
            className: 'dshqf-annotation' + (hover !== null && hover.id === item.id ? ' dshqf-annotationActive' : ''),
            role: 'listitem',
            tabIndex: 0,
            onMouseEnter: (event) => showHover(item, event.currentTarget),
            onMouseLeave: scheduleHide,
            onFocus: (event) => showHover(item, event.currentTarget),
            onBlur: scheduleHide,
          },
            h('span', { className: 'dshqf-annotationNum', 'aria-hidden': true }, String(index + 1) + '.'),
            h('span', { className: 'dshqf-annotationLabel' }, t('annotation.label')),
            h('button', {
              type: 'button',
              className: 'dshqf-annotationRemove',
              'aria-label': t('annotation.remove'),
              title: t('annotation.remove'),
              onMouseDown: (event) => { event.stopPropagation?.() },
              onClick: (event) => {
                event.stopPropagation?.()
                if (hover !== null && hover.id === item.id) setHover(null)
                removeAnnotation(sessionId, item.id)
              },
            }, '×'))))
        const markerEl = h('span', { key: 'annotation-marker', ref: setMarker, hidden: true })
        if (host === null) return markerEl
        return h(React.Fragment, null, markerEl, createPortal(row, host), hoverPanel)
      }
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

    /**
     * @param {unknown} target - selection anchor element.
     * @returns {boolean} whether the target is part of a text editor.
     */
    function insideEditable(target) {
      if (target === null || target === undefined || typeof target.closest !== 'function') return false
      return target.closest('[contenteditable]:not([contenteditable="false"]), textarea, input') !== null
    }

    /**
     * @param {unknown} target - selection anchor element.
     * @returns {string} Session id owning the selection, or ''.
     */
    function sessionIdForSelection(target) {
      if (target !== null && target !== undefined && typeof target.closest === 'function') {
        const host = target.closest('[data-conversation-session]')
        const id = host?.getAttribute?.('data-conversation-session') ?? ''
        if (id !== '') return id
      }
      return currentSessionIdOf()
    }

    /** @param {object} options @returns {boolean} */
    function canOfferSelection(options) {
      return typeof options.text === 'string' && options.text.trim() !== ''
        && typeof options.sessionId === 'string' && options.sessionId !== ''
        && options.inPanel !== true
        && options.inEditable !== true
        && isTempChild(options.sessionId) !== true
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
     * Build the selection action layer: one capsule, two actions.
     * @param {object} ctx - root client context.
     * @returns {Function} React component.
     */
    function createSelectionLayer(ctx) {
      return function SelectionLayer() {
        const [bubble, setBubble] = useState(null)
        const [position, setPosition] = useState(null)
        const bubbleRef = useRef(null)
        useEffect(() => {
          const clear = () => {
            setBubble(null)
            setPosition(null)
          }
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
              const inPanel = insideQuickForkPanel(element)
              const inEditable = insideEditable(element)
              const sessionId = sessionIdForSelection(element)
              if (!canOfferSelection({ text, sessionId, inPanel, inEditable })) {
                clear()
                return
              }
              const rect = selection.getRangeAt(0).getBoundingClientRect()
              if (rect.width < 1 || rect.height < 1) {
                clear()
                return
              }
              setBubble({ text: text.slice(0, ANNOTATION_MAX_TEXT), x: rect.left + rect.width / 2, y: rect.top, sessionId })
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
        // Measure the capsule before painting so it never flashes at a stale spot.
        useLayoutEffect(() => {
          if (bubble === null || bubbleRef.current === null) {
            setPosition(null)
            return
          }
          const rect = bubbleRef.current.getBoundingClientRect()
          const viewport = typeof window.innerWidth === 'number' ? window.innerWidth : 0
          const left = Math.min(Math.max(8, bubble.x - rect.width / 2), Math.max(8, viewport - rect.width - 8))
          const top = Math.max(8, bubble.y - rect.height - 8)
          setPosition({ left, top })
        }, [bubble])
        if (bubble === null) return null
        const close = () => {
          setBubble(null)
          setPosition(null)
        }
        const addToChat = () => {
          const added = addAnnotation(bubble.sessionId, bubble.text)
          if (!added) {
            try { inputShellOf(ctx, bubble.sessionId)?.notify?.('error', tRef(ctx, 'bubble.addFailed')) } catch { /* notice is best effort */ }
          } else {
            try { inputShellOf(ctx, bubble.sessionId)?.focus?.() } catch { /* focus is best effort */ }
          }
          close()
        }
        const openSideChat = () => {
          const sidebar = ctx.get('sidebarRight')
          if (sidebar === null || sidebar === undefined || typeof sidebar.openTab !== 'function') {
            close()
            return
          }
          sidebar.openTab(KIND, {
            params: { parentSessionId: bubble.sessionId, quote: bubble.text.slice(0, 2000) },
          })
          close()
        }
        const style = position === null
          ? { left: '-9999px', top: '-9999px' }
          : { left: position.left + 'px', top: position.top + 'px' }
        return createPortal(h('div', {
          className: 'dshqf-capsule',
          ref: bubbleRef,
          role: 'toolbar',
          'aria-label': tRef(ctx, 'bubble.aria'),
          'data-dsh-quick-fork-bubble': '',
          style,
          onMouseDown: (event) => { event.preventDefault?.() },
        },
          h('button', {
            type: 'button',
            className: 'dshqf-capsuleBtn',
            'aria-label': tRef(ctx, 'bubble.addToChatAria'),
            onClick: addToChat,
          }, tRef(ctx, 'bubble.addToChat')),
          h('button', {
            type: 'button',
            className: 'dshqf-capsuleBtn',
            'aria-label': tRef(ctx, 'bubble.addToTempChatAria'),
            onClick: openSideChat,
          }, tRef(ctx, 'bubble.addToTempChat'))), document.body)
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
.dshqf-capsule{position:fixed;z-index:120;display:inline-flex;align-items:stretch;height:30px;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-soft);font:inherit;font-size:12px;line-height:1;overflow:hidden}
.dshqf-capsuleBtn{appearance:none;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1;padding:0 12px;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;cursor:pointer}
.dshqf-capsuleBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshqf-capsuleBtn:active{background:var(--dsw-alias-interactive-bg-active)}
.dshqf-capsuleBtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dshqf-capsuleBtn+.dshqf-capsuleBtn{border-left:1px solid var(--dsw-alias-border-l2)}
.dshqf-annotations{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.dshqf-annotationRow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.dshqf-annotation{display:inline-flex;align-items:center;gap:6px;max-width:260px;height:24px;padding:0 4px 0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;outline:none}
.dshqf-annotation:hover,.dshqf-annotationActive{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshqf-annotation:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dshqf-annotationNum{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dshqf-annotationLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshqf-annotationRemove{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;cursor:pointer}
.dshqf-annotationRemove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshqf-annotationPanel{position:fixed;z-index:130;box-sizing:border-box;width:max-content;min-width:200px;max-width:min(420px,calc(100vw - 16px));border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-elevation-soft);padding:10px 12px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5}
.dshqf-annotationPanelTitle{font-weight:600;margin-bottom:6px}
.dshqf-annotationPanelText{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;color:var(--dsw-alias-label-secondary)}
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
      const AnnotationChipLayer = createAnnotationChips(ctx)
      const Panel = createPanel(ctx)
      const tabDefinition = tabDefinitionFor((key) => {
        try { return ctx.locale.bind(NS)(key) } catch { return key }
      })

      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'quick-fork.selection',
      }, SelectionLayer)), 'quick-fork: selection bubble')

      ctx.effect(() => ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
        name: 'conversation.input.overlay',
        id: 'quick-fork.annotations',
        order: 40,
        locale: NS,
        inject: (sessionId) => ({ sessionId }),
      }, AnnotationChipLayer)), 'quick-fork: annotation chips')

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
      __test: {
        parseForkParams,
        nodesToMessages,
        tabDefinitionFor,
        canOfferSelection,
        composePrompt,
        quoteBlockOf,
        maxSeqOf,
        annotationContextOf,
        addAnnotation,
        annotationItemsOf,
        removeAnnotation,
        forgetAnnotations,
        restoreAnnotations,
        ensureAnnotationPromptWrapper,
      },
    }
  },
})
