## 2024-05-24 - Sidebar Item Focus Visibility
**Learning:** The `button` and `a` elements in the sidebar items lacked proper focus rings, making keyboard navigation difficult to track.
**Action:** Applied the `focus-visible:ring-2 focus-visible:ring-focus-ring/35` utility classes to ensure a clear focus indicator is present.

## 2024-05-31 - Modus Input Focus Enhancements
**Learning:** Found that custom inputs within the Modus system sometimes lack sufficient focus indication. Setting `outline-none` but not applying a `ring` or custom focus outline leads to inaccessible inputs.
**Action:** When adding or modifying custom input elements, ensure they receive focus states by applying standard ring utilities: `focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/35`.

## 2024-06-21 - [Palette: Adjust primary button focus styles]
**Learning:** The default primary button style has a subtle box-shadow for focus that gets lost against similar backgrounds (contrast ratio < 3:1).
**Action:** Switched primary button focus states to use a solid outline with an offset: `outline: 2px solid var(--color-accent); outline-offset: 2px;` to guarantee sufficient contrast.

## 2025-02-14 - [Palette: Ensure Checkbox Focus Contrast]
**Learning:** Our custom checkbox component was using `ring-focus-ring/35` for its focus state, which only provided a 1.8:1 contrast ratio against the background, failing accessibility standards.
**Action:** Changed custom checkbox focus styles to use a solid outline (`focus-visible:ring-2 focus-visible:ring-focus-ring`) to ensure a >= 3:1 contrast ratio for keyboard focus indicators, adhering to the updated Modus UI rules.

## 2025-02-28 - [Palette: Add focus rings to FileReference links]
**Learning:** Elements styled as interactive chips (like `FileReference` and `Badge`) often lack focus rings because they use custom rendering instead of standard button styles.
**Action:** Always add `outline-none focus-visible:ring-2 focus-visible:ring-focus-ring` to custom interactive inline elements to ensure keyboard accessibility.

## 2026-10-18 - [Add missing focus-visible styles to UI icon buttons]
**Learning:** Several shared UI icon buttons (`CopyButton`, `ToolbarButton`, and `MorphingDialog` close button) were missing explicit `focus-visible` styles, creating keyboard accessibility traps where focus state was invisible to users.
**Action:** When adding new icon buttons, always verify tab focus states visually or ensure standard `outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/35` utility classes are included alongside hover state tokens.

2026-10-21 - [Palette: Add missing focus-visible styles to UI icon buttons]
**Learning:** Shared UI components and layout components (`AutomationsPage`, `CheckpointRestoreButton`, `AppSidebar`, `NavRail`) had missing explicit `focus-visible` styles, creating keyboard accessibility traps where focus state was invisible to users.
**Action:** When adding new interactive components, always ensure standard `outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/35` utility classes are included alongside hover state tokens.

2026-10-23 - [Palette: Add focus-visible styles to ImageViewer components]
**Learning:** Interactive ImageViewer components (ImageThumb, ViewerAction) were missing explicit `focus-visible` styles, creating keyboard accessibility traps where focus state was invisible to users.
**Action:** When adding new interactive components, always ensure standard `outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/35` utility classes are included alongside hover state tokens.
2026-10-24 - Add focus visible styles to WorkStatusLine toggle
**Learning:** Some custom UI elements with `.work-status-line__toggle` (e.g. progress disclosures during reasoning) lacked `focus-visible` styles which meant keyboard tabbing did not show an active ring.
**Action:** Always ensure `button`s or elements handling click interactions have `focus-visible:ring-2 focus-visible:ring-focus-ring/35` either via classes or `@apply` in global CSS. Pre-existing test failures (e.g. `qa-evidence.test.ts`) that are un-related to my style changes should be documented instead of fixed per guidelines.
2026-10-24 - Add focus visible styles to WorkStatusLine toggle
**Learning:** Some custom UI elements with `.work-status-line__toggle` (e.g. progress disclosures during reasoning) lacked `focus-visible` styles which meant keyboard tabbing did not show an active ring.
**Action:** Always ensure `button`s or elements handling click interactions have `focus-visible:ring-2 focus-visible:ring-focus-ring/35` either via classes or `@apply` in global CSS. Pre-existing test failures (e.g. `qa-evidence.test.ts`) that are un-related to my style changes should be documented instead of fixed per guidelines.
2026-10-28 - [Palette: Add missing focus-visible styles to Plan components]
**Learning:** Some custom UI elements in `PlanTool.tsx`, `ReviewPlanCard.tsx`, and `PlanTimelineCard.tsx` (like icon-only buttons for expand/collapse and close) lacked `focus-visible` styles which meant keyboard tabbing did not show an active ring. Also Playwright electron launch failed during verification due to headless display issues on testing environment.
**Action:** Always ensure `button`s or elements handling click interactions have `focus-visible:ring-2 focus-visible:ring-focus-ring/35` either via classes or `@apply` in global CSS. Document verification environment limitations if real screenshots cannot be captured.

2026-10-25 - [Palette: Add focus-visible styles to QuestionCard buttons]
**Learning:** Interactive QuestionCard controls need an explicit visible focus treatment, especially when their default outline is suppressed.
**Action:** Ensure keyboard-operated custom buttons retain a visible focus ring and adequate surrounding space.

2026-10-25 - [Palette: Add focus-visible style to "Open file" button in FilesPanel]
**Learning:** Some custom UI buttons (like the FilesPanel's Open button) use `outline-none` but lack an explicit `focus-visible` fallback, making keyboard focus invisible. A solid focus ring can also provide better contrast than a translucent ring.
**Action:** Add an explicit `focus-visible` ring to custom buttons that suppress their outline, and check the component's mounted context before changing shared UI.
2026-11-05 - [Palette: Add focus-visible style to "Open externally" button in PreviewHost]
**Learning:** Shared UI custom buttons (like the PreviewHost`s Open externally button) use `outline-none` but lack an explicit `focus-visible` fallback, making keyboard focus invisible.
**Action:** Add an explicit `focus-visible` ring to custom buttons that suppress their outline to ensure accessibility standards are met and ensure node limits are increased via `NODE_OPTIONS` during memory-intensive test executions.

## 2026-10-18 - [Add missing focus-visible styles to UI icon buttons]
**Learning:** Several shared UI icon buttons (`CopyButton`, `ToolbarButton`, and `MorphingDialog` close button) were missing explicit `focus-visible` styles, creating keyboard accessibility traps where focus state was invisible to users.
**Action:** When adding new icon buttons, always verify tab focus states visually or ensure standard `outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/35` utility classes are included alongside hover state tokens.

## 2026-10-21 - [Palette: Add missing focus-visible styles to UI icon buttons]
**Learning:** Shared UI components and layout components (`AutomationsPage`, `CheckpointRestoreButton`, `AppSidebar`, `NavRail`) had missing explicit `focus-visible` styles, creating keyboard accessibility traps where focus state was invisible to users.
**Action:** When adding new interactive components, always ensure standard `outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/35` utility classes are included alongside hover state tokens.

## 2026-10-23 - [Palette: Add focus-visible styles to ImageViewer components]
**Learning:** Interactive ImageViewer components (ImageThumb, ViewerAction) were missing explicit `focus-visible` styles, creating keyboard accessibility traps where focus state was invisible to users.
**Action:** When adding new interactive components, always ensure standard `outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/35` utility classes are included alongside hover state tokens.

## 2026-10-24 - Add focus visible styles to WorkStatusLine toggle
**Learning:** Some custom UI elements with `.work-status-line__toggle` (e.g. progress disclosures during reasoning) lacked `focus-visible` styles which meant keyboard tabbing did not show an active ring.
**Action:** Always ensure `button`s or elements handling click interactions have `focus-visible:ring-2 focus-visible:ring-focus-ring/35` either via classes or `@apply` in global CSS. Pre-existing test failures (e.g. `qa-evidence.test.ts`) that are un-related to my style changes should be documented instead of fixed per guidelines.

## 2026-10-28 - [Palette: Add missing focus-visible styles to Plan components]
**Learning:** Some custom UI elements in `PlanTool.tsx`, `ReviewPlanCard.tsx`, and `PlanTimelineCard.tsx` (like icon-only buttons for expand/collapse and close) lacked `focus-visible` styles which meant keyboard tabbing did not show an active ring. Also Playwright electron launch failed during verification due to headless display issues on testing environment.
**Action:** Always ensure `button`s or elements handling click interactions have `focus-visible:ring-2 focus-visible:ring-focus-ring/35` either via classes or `@apply` in global CSS. Document verification environment limitations if real screenshots cannot be captured.

## 2026-10-25 - [Palette: Add focus-visible styles to QuestionCard buttons]
**Learning:** Interactive QuestionCard controls need an explicit visible focus treatment, especially when their default outline is suppressed.
**Action:** Ensure keyboard-operated custom buttons retain a visible focus ring and adequate surrounding space.

## 2026-10-25 - [Palette: Add focus-visible style to "Open file" button in FilesPanel]
**Learning:** Some custom UI buttons (like the FilesPanel's Open button) use `outline-none` but lack an explicit `focus-visible` fallback, making keyboard focus invisible. A solid focus ring can also provide better contrast than a translucent ring.
**Action:** Add an explicit `focus-visible` ring to custom buttons that suppress their outline, and check the component's mounted context before changing shared UI.

## 2026-10-31 - [Palette: Remove low-opacity focus ring from WorkStatusLine toggle]
**Learning:** Shared global classes using translucent focus rings (e.g., `/35` opacity on `focus-ring`) can violate contrast guidelines (>= 4.5:1). A solid focus ring (`focus-visible:ring-focus-ring`) should be used instead.
**Action:** Remove opacity modifiers from explicit `focus-visible:ring-focus-ring` classes to ensure solid focus styles and adequate contrast. Pre-existing out-of-scope test failures should be documented and left unfixed.

## 2026-11-05 - [Palette: Add focus-visible style to "Open externally" button in PreviewHost]
**Learning:** Shared UI custom buttons (like the PreviewHost`s Open externally button) use `outline-none` but lack an explicit `focus-visible` fallback, making keyboard focus invisible.
**Action:** Add an explicit `focus-visible` ring to custom buttons that suppress their outline to ensure accessibility standards are met and ensure node limits are increased via `NODE_OPTIONS` during memory-intensive test executions.

## 2026-10-31 - Focus-visible token fix
**Learning:** Translucent focus rings can be hard to see.
**Action:** Use solid focus rings for adequate contrast.
