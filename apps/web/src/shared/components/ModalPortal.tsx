import { createPortal } from "react-dom";

/**
 * Renders children into a React Portal attached to `document.body`.
 *
 * This is necessary because the app's layout uses `overflow-hidden` combined
 * with `backdrop-blur` / `backdrop-filter` on ancestor elements (PanelLayout,
 * root layout).  In modern browsers these CSS properties create a new
 * **containing block** for `position: fixed` descendants, which means a
 * `fixed inset-0` modal rendered inside that tree gets **clipped** instead of
 * covering the full viewport.
 *
 * By portaling to `document.body` the modal escapes ALL ancestor overflow and
 * stacking-context traps, making it bulletproof at every viewport size.
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body);
}
