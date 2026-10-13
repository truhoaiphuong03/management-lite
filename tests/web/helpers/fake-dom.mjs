// Minimal DOM sufficient for react-dom/client (React 19) in node:test.
// Test-only helper: no network, no storage, no dependency added.
class FakeNode {
  constructor(doc, nodeType, name) {
    this.ownerDocument = doc;
    this.nodeType = nodeType;
    this.nodeName = name;
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling() {
    const s = this.parentNode?.childNodes;
    return s ? (s[s.indexOf(this) + 1] ?? null) : null;
  }
  get previousSibling() {
    const s = this.parentNode?.childNodes;
    return s ? (s[s.indexOf(this) - 1] ?? null) : null;
  }
  appendChild(c) {
    return this.insertBefore(c, null);
  }
  insertBefore(c, ref) {
    c.parentNode?.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  addEventListener(t, f) {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
  }
  removeEventListener(t, f) {
    this.listeners.set(
      t,
      (this.listeners.get(t) ?? []).filter((x) => x !== f),
    );
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (v !== '' && v != null)
      this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }
  contains(other) {
    if (!other) return false;
    let curr = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
  }
  querySelectorAll(selector) {
    const results = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          if (matchesSimpleSelector(child, selector)) {
            results.push(child);
          }
          walk(child);
        }
      }
    };
    walk(this);
    return results;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function matchesSimpleSelector(el, selector) {
  if (!el || el.nodeType !== 1) return false;
  const parts = selector.split(',').map((s) => s.trim());
  return parts.some((part) => {
    let target = part;
    let notArg = null;
    if (target.includes(':not(')) {
      const match = target.match(/^(.*?):not\((.*?)\)$/);
      if (match) {
        target = match[1].trim();
        notArg = match[2].trim();
      }
    }

    if (notArg) {
      if (notArg === '[disabled]' && el.disabled) return false;
      if (notArg === '[tabindex="-1"]' && el.getAttribute('tabindex') === '-1')
        return false;
      if (notArg.startsWith('[') && notArg.endsWith(']')) {
        const inner = notArg.slice(1, -1);
        if (inner.includes('=')) {
          const [k, v] = inner.split('=');
          const cleanV = v.replace(/^["']|["']$/g, '');
          if (el.getAttribute(k.trim()) === cleanV) return false;
        } else if (el.hasAttribute(inner.trim())) {
          return false;
        }
      }
    }

    if (!target) return true;

    if (/^[A-Za-z0-9_-]+$/.test(target)) {
      return el.nodeName === target.toUpperCase();
    }

    if (target.startsWith('[') && target.endsWith(']')) {
      const inner = target.slice(1, -1);
      if (inner.includes('=')) {
        const [k, v] = inner.split('=');
        const cleanV = v.replace(/^["']|["']$/g, '');
        return el.getAttribute(k.trim()) === cleanV;
      }
      return el.hasAttribute(inner.trim());
    }

    return false;
  });
}
class FakeText extends FakeNode {
  constructor(doc, text) {
    super(doc, 3, '#text');
    this.nodeValue = text;
  }
  get textContent() {
    return this.nodeValue;
  }
  set textContent(v) {
    this.nodeValue = String(v);
  }
  get data() {
    return this.nodeValue;
  }
  set data(v) {
    this.nodeValue = String(v);
  }
}
class FakeElement extends FakeNode {
  constructor(doc, tag) {
    super(doc, 1, tag.toUpperCase());
    this.tagName = this.nodeName;
    this.localName = tag;
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.attributes = {};
    this.style = {};
    this.value = '';
    this.disabled = false;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'value') this.value = String(v);
  }
  getAttribute(k) {
    return k in this.attributes ? this.attributes[k] : null;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }
  hasAttribute(k) {
    return k in this.attributes;
  }
  get options() {
    const out = [];
    const walk = (n) =>
      n.childNodes.forEach((c) => {
        if (c.nodeName === 'OPTION') out.push(c);
        walk(c);
      });
    walk(this);
    return out;
  }
  closest(selector) {
    if (matchesSimpleSelector(this, selector)) return this;
    let node = this.parentNode;
    while (node && node.nodeType === 1) {
      if (matchesSimpleSelector(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }
  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = null;
    }
  }
}
export function installFakeDom() {
  const doc = new FakeNode(null, 9, '#document');
  doc.ownerDocument = doc;
  doc.createElement = (t) => new FakeElement(doc, t);
  doc.createElementNS = (_ns, t) => new FakeElement(doc, t);
  doc.createTextNode = (t) => new FakeText(doc, t);
  doc.createComment = (t) => new FakeText(doc, t);
  doc.activeElement = null;
  doc.documentElement = new FakeElement(doc, 'html');
  doc.head = new FakeElement(doc, 'head');
  doc.body = new FakeElement(doc, 'body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.getElementById = (id) => doc.querySelector('#' + id);
  const docListeners = new Map();
  doc.listeners = docListeners;
  doc.addEventListener = (t, f) => {
    docListeners.set(t, [...(docListeners.get(t) ?? []), f]);
  };
  doc.removeEventListener = (t, f) => {
    docListeners.set(
      t,
      (docListeners.get(t) ?? []).filter((x) => x !== f),
    );
  };
  doc.dispatchEvent = (e) => {
    const list = docListeners.get(e?.type) ?? [];
    list.forEach((fn) => fn(e));
    return true;
  };
  const winListeners = new Map();
  const win = {
    document: doc,
    HTMLIFrameElement: class {},
    addEventListener: (t, f) => {
      winListeners.set(t, [...(winListeners.get(t) ?? []), f]);
    },
    removeEventListener: (t, f) => {
      winListeners.set(
        t,
        (winListeners.get(t) ?? []).filter((x) => x !== f),
      );
    },
    dispatchEvent: (e) => {
      const list = winListeners.get(e?.type) ?? [];
      list.forEach((fn) => fn(e));
      return true;
    },
    matchMedia: (q) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  };
  const createStorageMock = () => {
    const store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (i) => Array.from(store.keys())[i] ?? null,
    };
  };
  win.localStorage = createStorageMock();
  win.sessionStorage = createStorageMock();
  doc.defaultView = win;
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = win.localStorage;
  globalThis.sessionStorage = win.sessionStorage;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    container: () => {
      const el = doc.createElement('div');
      doc.body.appendChild(el);
      return el;
    },
    find: (root, pred) => {
      const out = [];
      const walk = (n) =>
        n.childNodes.forEach((c) => {
          if (c.nodeType === 1 && pred(c)) out.push(c);
          walk(c);
        });
      walk(root);
      return out;
    },
    props: (el) => {
      const k = Object.keys(el).find((x) => x.startsWith('__reactProps$'));
      return k ? el[k] : {};
    },
  };
}
