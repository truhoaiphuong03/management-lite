import type {
  RoundingModeType,
  ShippingAllocationStrategyType,
} from '../../../packages/contracts/src/printquote.js';
import type { DraftLineState } from './screens/printquote/types.js';

/**
 * Pure in-memory (RAM-only) draft state for PrintQuote UX V2.
 * SECURITY INVARIANT: Never persist vendor costs, profit margins, or quote drafts
 * to localStorage, sessionStorage, IndexedDB, cookies, or URL query parameters.
 */
export interface PrintQuoteRamDraftSnapshot {
  mode: 'new' | 'edit';
  editingQuoteId: string | null;
  editingQuoteCode: string | null;
  editingQuoteVersion: number;
  editorPath: string;
  quoteTitle: string;
  selectedCustomerId: string;
  validUntil: string;
  shippingFee: number;
  shippingFeeInput: string;
  includeShippingInUnitPrice: boolean;
  shippingAllocation: ShippingAllocationStrategyType;
  roundingMode: RoundingModeType;
  roundingStep: number;
  customerNotes: string;
  internalNotes: string;
  versionChangeNote: string;
  draftLines: DraftLineState[];
  hasTouchedFields: boolean;
  isDirty: boolean;
}

export interface PrintQuoteDraftOwnerIdentity {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: 'owner';
}

let ramDraft: PrintQuoteRamDraftSnapshot | null = null;
let draftOwnerIdentity: PrintQuoteDraftOwnerIdentity | null = null;
let activeSessionOwnerIdentity: PrintQuoteDraftOwnerIdentity | null = null;
let leaveInterceptor: ((proceed: () => void) => void) | null = null;
let fallbackLeavePendingAction: (() => void) | null = null;
let beforeUnloadBound = false;
const subscribers = new Set<() => void>();

function notifyDraftSubscribers(): void {
  for (const listener of subscribers) {
    listener();
  }
}

export function handlePrintQuoteBeforeUnload(
  e: BeforeUnloadEvent,
): string | undefined {
  if (!isPrintQuoteDraftDirty()) {
    return undefined;
  }
  e.preventDefault();
  if ('returnValue' in e) {
    try {
      e.returnValue = '';
    } catch {
      // Ignore read-only synthetic event returnValue
    }
  }
  return '';
}

function syncBeforeUnloadGuard(): void {
  if (
    typeof window === 'undefined' ||
    typeof window.addEventListener !== 'function'
  ) {
    return;
  }
  const dirty = isPrintQuoteDraftDirty();
  if (dirty && !beforeUnloadBound) {
    window.addEventListener('beforeunload', handlePrintQuoteBeforeUnload);
    beforeUnloadBound = true;
  } else if (!dirty && beforeUnloadBound) {
    window.removeEventListener('beforeunload', handlePrintQuoteBeforeUnload);
    beforeUnloadBound = false;
  }
}

export function isInternalPrintQuotePath(pathname: string): boolean {
  const clean = pathname.split(/[?#]/, 1)[0] || '/';
  return clean === '/print-quotes' || clean.startsWith('/print-quotes/');
}

export function getPrintQuoteRamDraft(): PrintQuoteRamDraftSnapshot | null {
  return ramDraft;
}

export function getPrintQuoteDraftOwner(): PrintQuoteDraftOwnerIdentity | null {
  return draftOwnerIdentity ? { ...draftOwnerIdentity } : null;
}

export function setPrintQuoteRamDraft(
  next: PrintQuoteRamDraftSnapshot | null,
  explicitOwner?: PrintQuoteDraftOwnerIdentity | null,
): void {
  if (next === null) {
    ramDraft = null;
    draftOwnerIdentity = null;
    fallbackLeavePendingAction = null;
  } else {
    ramDraft = next;
    if (explicitOwner !== undefined) {
      draftOwnerIdentity = explicitOwner ? { ...explicitOwner } : null;
    } else if (draftOwnerIdentity === null && activeSessionOwnerIdentity) {
      draftOwnerIdentity = { ...activeSessionOwnerIdentity };
    }
    if (!next.isDirty) {
      fallbackLeavePendingAction = null;
    }
  }
  syncBeforeUnloadGuard();
  notifyDraftSubscribers();
}

export function clearPrintQuoteRamDraft(): void {
  const hadState =
    ramDraft !== null ||
    fallbackLeavePendingAction !== null ||
    draftOwnerIdentity !== null;
  ramDraft = null;
  draftOwnerIdentity = null;
  fallbackLeavePendingAction = null;
  syncBeforeUnloadGuard();
  if (hadState) {
    notifyDraftSubscribers();
  }
}

export function clearPrintQuoteSessionIdentity(): void {
  activeSessionOwnerIdentity = null;
}

export function bindPrintQuoteDraftOwnerFromActiveTracker(candidate: {
  isLoggedIn: boolean;
  verifiedOwnerSession: boolean;
  role: string;
  userId?: string | undefined;
  workspaceId?: string | undefined;
}): void {
  if (
    candidate.isLoggedIn &&
    candidate.verifiedOwnerSession &&
    candidate.role === 'owner' &&
    candidate.userId &&
    candidate.workspaceId
  ) {
    const owner: PrintQuoteDraftOwnerIdentity = {
      userId: candidate.userId,
      workspaceId: candidate.workspaceId,
      role: 'owner',
    };
    activeSessionOwnerIdentity = owner;
    if (ramDraft !== null && draftOwnerIdentity === null) {
      draftOwnerIdentity = owner;
    }
  }
}

export function purgeUnattributedPrintQuoteDraft(): void {
  activeSessionOwnerIdentity = null;
  if (ramDraft !== null && draftOwnerIdentity === null) {
    clearPrintQuoteRamDraft();
  }
}

export function reconcilePrintQuoteDraftWithVerifiedSession(session: {
  isOwner: boolean;
  role: string;
  userId?: string | undefined;
  workspaceId?: string | undefined;
}): boolean {
  if (
    !session.isOwner ||
    session.role !== 'owner' ||
    !session.userId ||
    !session.workspaceId
  ) {
    activeSessionOwnerIdentity = null;
    clearPrintQuoteRamDraft();
    return false;
  }

  const verifiedOwner: PrintQuoteDraftOwnerIdentity = {
    userId: session.userId,
    workspaceId: session.workspaceId,
    role: 'owner',
  };

  if (ramDraft !== null) {
    const sameBoundOwner =
      draftOwnerIdentity !== null &&
      draftOwnerIdentity.role === 'owner' &&
      draftOwnerIdentity.userId === verifiedOwner.userId &&
      draftOwnerIdentity.workspaceId === verifiedOwner.workspaceId;
    if (!sameBoundOwner) {
      clearPrintQuoteRamDraft();
      activeSessionOwnerIdentity = verifiedOwner;
      return false;
    }
  }

  activeSessionOwnerIdentity = verifiedOwner;
  return true;
}

export function getVerifiedActivePrintQuoteEditorPath(): string | null {
  if (
    !ramDraft ||
    !ramDraft.isDirty ||
    !draftOwnerIdentity ||
    !activeSessionOwnerIdentity ||
    draftOwnerIdentity.role !== 'owner' ||
    activeSessionOwnerIdentity.role !== 'owner' ||
    draftOwnerIdentity.userId !== activeSessionOwnerIdentity.userId ||
    draftOwnerIdentity.workspaceId !== activeSessionOwnerIdentity.workspaceId
  ) {
    return null;
  }
  const candidate = ramDraft.editorPath || '/print-quotes/new';
  return isInternalPrintQuotePath(candidate) ? candidate : '/print-quotes/new';
}

export function isPrintQuoteDraftDirty(): boolean {
  return Boolean(ramDraft?.isDirty);
}

export function subscribePrintQuoteDraft(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function registerPrintQuoteLeaveInterceptor(
  handler: ((proceed: () => void) => void) | null,
): void {
  leaveInterceptor = handler;
}

export function hasPrintQuoteLeaveInterceptor(): boolean {
  return leaveInterceptor !== null;
}

export function hasPendingPrintQuoteFallbackLeave(): boolean {
  return fallbackLeavePendingAction !== null;
}

export function stayOnPrintQuoteFallbackLeave(): void {
  if (fallbackLeavePendingAction !== null) {
    fallbackLeavePendingAction = null;
    notifyDraftSubscribers();
  }
}

export function discardAndProceedPrintQuoteFallbackLeave(): void {
  const proceed = fallbackLeavePendingAction;
  fallbackLeavePendingAction = null;
  clearPrintQuoteRamDraft();
  proceed?.();
}

/**
 * Fail-closed leave guard:
 * - Returns false only when there is no dirty draft.
 * - When dirty and a screen leaveInterceptor is registered, delegates to it and blocks navigation.
 * - When dirty and leaveInterceptor is null (e.g. screen unmounted or still lazy-loading),
 *   NEVER wipes the RAM draft or calls proceed() silently: queues fallbackLeavePendingAction
 *   for the root App shell confirmation modal (or keeps navigation safely blocked in headless callers).
 */
export function confirmLeavePrintQuoteIfNeeded(proceed: () => void): boolean {
  if (!isPrintQuoteDraftDirty()) {
    return false;
  }
  if (leaveInterceptor) {
    fallbackLeavePendingAction = null;
    leaveInterceptor(proceed);
    return true;
  }
  fallbackLeavePendingAction = proceed;
  notifyDraftSubscribers();
  return true;
}
