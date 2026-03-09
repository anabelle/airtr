/**
 * Mobile overlay spacing is aligned to the floating topbar toggle, which sits
 * 0.75rem from the viewport edge and is roughly 4rem tall including its shadow
 * and tap target envelope. These helpers keep full-screen sheets and panels
 * below that control on phones while preserving the existing desktop layout.
 */
export const MOBILE_TOPBAR_PANEL_PADDING_CLASS = "pt-[4.75rem]";
export const MOBILE_TOPBAR_TOP_CLASS = "top-[4.75rem]";
export const MOBILE_BOTTOM_NAV_BOTTOM_CLASS = "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]";
export const MOBILE_OVERLAY_HEIGHT_CLASS = "h-[calc(100dvh-4.75rem-env(safe-area-inset-bottom))]";
export const MOBILE_OVERLAY_MAX_HEIGHT_CLASS =
  "max-h-[calc(100dvh-4.75rem-env(safe-area-inset-bottom))]";
