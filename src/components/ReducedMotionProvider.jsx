"use client";

import { MotionConfig } from "framer-motion";

/**
 * Wraps the app in Framer Motion's <MotionConfig reducedMotion="user"> so every
 * motion component respects the user's OS-level `prefers-reduced-motion` setting.
 *
 * When reduced motion is enabled, Framer Motion automatically disables transform
 * and layout animations (x, y, scale, rotate, layout) while preserving opacity
 * and color animations. Because all of our entry/scroll animations pair
 * `opacity` with their transform, the reduced-motion fallback degrades to a
 * graceful opacity fade instead of an instant pop — no element translates or
 * scales on scroll/enter. The default experience is unchanged for other users.
 *
 * This is a client component because MotionConfig relies on React context and
 * effects, while the root layout must remain a server component (it exports
 * `metadata`). See CONTRIBUTING.md "Accessibility: Reduced Motion".
 */
export default function ReducedMotionProvider({ children }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
