export interface DesktopWindowCandidate {
  handle: string;
  processId: number;
  processName: string;
  title: string;
  visible: boolean;
  minimized: boolean;
  isMainWindow: boolean;
  zOrder: number;
  /** Top-level owner window, when Windows reports one (dialogs/popups). */
  ownerHandle?: string;
  /** Root owner window, useful when ownership is nested through another dialog. */
  rootOwnerHandle?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface DesktopWindowQuery {
  handle?: string;
  processId?: number;
  processName?: string;
  title?: string;
  includeMinimized?: boolean;
}

export interface OwnedDesktopWindowOptions {
  includeMinimized?: boolean;
  includeInvisible?: boolean;
}

export function selectDesktopWindow<T extends DesktopWindowCandidate>(
  candidates: readonly T[],
  query: DesktopWindowQuery,
): T | undefined {
  const normalizedTitle = query.title === undefined ? undefined : normalizeWindowTitleForMatching(query.title);
  const normalizedProcessName = query.processName === undefined
    ? undefined
    : normalizeProcessNameForMatching(query.processName);

  const eligible = candidates.filter((candidate) => (
    candidate.visible
    && (query.includeMinimized === true || !candidate.minimized)
    && (!query.handle || candidate.handle === query.handle)
    && (query.processId === undefined || candidate.processId === query.processId)
    && (!normalizedProcessName || normalizeProcessNameForMatching(candidate.processName) === normalizedProcessName)
    && (!normalizedTitle || normalizeWindowTitleForMatching(candidate.title).includes(normalizedTitle))
  ));
  if (eligible.length === 0) return undefined;

  if (query.handle) return eligible[0];

  const exactTitle = normalizedTitle
    ? eligible.find((candidate) => normalizeWindowTitleForMatching(candidate.title) === normalizedTitle)
    : undefined;
  if (exactTitle) return exactTitle;

  const mainWindow = eligible.find((candidate) => candidate.isMainWindow);
  if (mainWindow) return mainWindow;

  return [...eligible].sort((left, right) => left.zOrder - right.zOrder)[0];
}

/**
 * Return only top-level windows owned by a confirmed application window.
 *
 * Ownership is intentionally stricter than process identity. A process can
 * host unrelated top-level windows, while an owner/root-owner relationship is
 * the Windows contract for dialogs and transient popups belonging to a main
 * window. Callers may explicitly opt into minimized/invisible windows for
 * diagnostics; capture defaults to visible, non-minimized windows.
 */
export function selectOwnedDesktopWindows<T extends DesktopWindowCandidate>(
  candidates: readonly T[],
  owner: Pick<T, "handle" | "processId">,
  options: OwnedDesktopWindowOptions = {},
): T[] {
  return candidates
    .filter((candidate) => candidate.handle !== owner.handle)
    .filter((candidate) => candidate.processId === owner.processId)
    .filter((candidate) => candidate.ownerHandle === owner.handle || candidate.rootOwnerHandle === owner.handle)
    .filter((candidate) => options.includeInvisible === true || candidate.visible)
    .filter((candidate) => options.includeMinimized === true || !candidate.minimized)
    .sort((left, right) => left.zOrder - right.zOrder);
}

/**
 * Return visible, non-minimized foreign windows that are above and overlap a
 * target. This is diagnostic metadata only: it never changes z-order and does
 * not authorize fallback capture from the desktop.
 */
export function selectOccludingDesktopWindows<T extends DesktopWindowCandidate>(
  candidates: readonly T[],
  target: Pick<T, "handle" | "processId" | "zOrder" | "bounds">,
): T[] {
  if (!target.bounds) return [];
  return candidates
    .filter((candidate) => candidate.handle !== target.handle)
    .filter((candidate) => candidate.processId !== target.processId)
    .filter((candidate) => candidate.visible && !candidate.minimized)
    .filter((candidate) => candidate.zOrder < target.zOrder)
    .filter((candidate) => candidate.bounds !== undefined && meaningfullyOverlaps(candidate.bounds, target.bounds!))
    .sort((left, right) => left.zOrder - right.zOrder);
}

function meaningfullyOverlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  const leftEdge = Math.max(left.x, right.x);
  const topEdge = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  const overlapWidth = rightEdge - leftEdge;
  const overlapHeight = bottomEdge - topEdge;
  if (overlapWidth <= 0 || overlapHeight <= 0) return false;
  const overlapArea = overlapWidth * overlapHeight;
  const targetArea = Math.max(1, right.width * right.height);
  return (overlapWidth >= 64 && overlapHeight >= 64) || overlapArea / targetArea >= 0.02;
}

/**
 * Windows can add document markers and UI chrome with variable whitespace or
 * a typographic dash. Matching the normalized form keeps a confirmed window
 * handle stable without weakening the process/title constraints.
 */
export function normalizeWindowTitleForMatching(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function normalizeProcessNameForMatching(value: string): string {
  return value.trim().replace(/\.exe$/i, "").toLocaleLowerCase();
}
