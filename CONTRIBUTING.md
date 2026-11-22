# Contributing to ScholarMarket

Thanks for contributing.

## Scope

ScholarMarket is an in-development educational content marketplace with a current web prototype and a planned Stellar-native settlement layer. Contributions should improve one of these areas:

- product clarity
- security
- Soroban contract design
- developer experience
- accessibility
- documentation

## Before You Start

1. Read [README.md](README.md).
2. If you are new to the project, start with the [Onboarding Guide](docs/onboarding.md) for a walkthrough of the repository structure, setup steps, and branching strategy.
3. Review [docs/overview.md](docs/overview.md) and [docs/architecture.md](docs/architecture.md).
4. Open an issue before starting large changes so architecture and scope can be aligned early.

## Local Setup

```bash
npm install
cp .env.example .env.local
docker compose up -d mongodb
npm run dev
```

To develop shared UI primitives, run `npm run storybook`; use `npm run build-storybook` to verify the static build. Add or update a story when changing a component in `src/components/ui`.

## Branching

- Use a short descriptive branch name such as `docs/stellar-submission` or `feat/entitlement-checks`.
- Keep pull requests focused. Avoid mixing documentation, refactors, and feature work unless the changes are tightly coupled.

## Coding Standards

- Keep changes small and reviewable.
- Prefer explicit naming over clever abstractions.
- Preserve the distinction between current prototype behavior and planned Stellar milestones.
- Do not claim a feature is on Stellar unless it is implemented and testable in this repository.
- Do not add new product work to the archived EVM prototype unless there is an explicit architecture decision to do so.
- Update documentation when architecture or environment requirements change.

## Accessibility: Reduced Motion

The app must respect a user's OS-level `prefers-reduced-motion` setting. This is handled in two layers, and new animations should follow the same patterns.

### Framer Motion (JS-driven animation)

The whole app is wrapped in `<MotionConfig reducedMotion="user">` via `src/components/ReducedMotionProvider.jsx`, which is mounted in all users in `src/app/layout.js`. When a user has enabled reduced motion, Framer Motion automatically disables transform and layout animations (`x`, `y`, `scale`, `rotate`, `layout`) while preserving `opacity` and color animations.

Because of this, **always pair `opacity` with any transform in entry/scroll animations**. This makes the reduced-motion fallback degrade to a graceful opacity fade instead of an instant pop, while leaving the default experience unchanged for other users.

Do:

```jsx
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

<motion.h1 initial="hidden" whileInView="show" variants={fadeUp} />
```

Avoid standalone transform-only entry animations (no opacity to fall back to):

```jsx
// Avoid: reduced-motion users get an instant pop with no fade.
<motion.h1 initial={{ y: 30 }} whileInView={{ y: 0 }} />
```

Continuous decorative loops (e.g. a floating card) that are transform-only are fine — they simply stop moving under reduced motion. Don't add opacity to them just to "fix" reduced motion; they should stay fully visible.

Do not add per-component `useReducedMotion` toggles. The global `MotionConfig` already handles the transform stripping consistently; component-level checks duplicate that logic and drift out of sync.

### CSS transitions and animations

CSS transitions and keyframe animations (Tailwind's `animate-pulse`, `animate-ping`, `animate-spin`, `animate-bounce`, and hover `transition-*` utilities) are not controlled by Framer Motion. A global override in `src/app/globals.css` neutralizes them under `@media (prefers-reduced-motion: reduce)` by clamping `animation-duration` and `transition-duration` to `0.01ms` so the final state still applies without visible motion.

- Don't fight this override with `!important` motion rules or inline animation durations.
- If you add a custom keyframe animation, it is covered automatically — no extra work needed.
- Prefer opacity/color transitions over transform-based transitions for state changes so the no-motion fallback still reads naturally.

## Pull Request Checklist

- The change is scoped and explained clearly.
- Relevant docs are updated.
- New environment variables are reflected in `.env.example`.
- Pull requests that change visible frontend behavior include screenshots or a short screen recording.
- Request/response examples are included when backend or API changes materially benefit from them.
- Any product or architectural assumptions are stated explicitly in the PR description.

## Commit Messages

Use concise, conventional commit messages when possible:

- `docs: rewrite README for Drip Wave submission`
- `chore: add contributor and license files`
- `docs: document Stellar architecture direction`
- `feat: add Soroban contract scaffolding`

## Reporting Issues

When opening an issue, include:

- expected behavior
- actual behavior
- reproduction steps
- screenshots or logs if relevant
- whether the issue affects the current prototype or the planned Stellar milestone

## Security

Do not disclose secrets, private keys, or production credentials in issues or pull requests. If you discover a sensitive security issue, contact the maintainer privately before public disclosure.
🌟 Stellar Contributors: See the [Stellar Integration Guide](docs/STELLAR_GUIDE.md) for setup instructions.
