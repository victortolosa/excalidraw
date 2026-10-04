# Drawings dashboard audit

## Brief and release

Implement the user-approved drawings prototype with real Excalidraw services. Product experience, React web, AA accessibility, visible field labels, desktop and narrow mobile, mouse/touch/keyboard. Preserve nested folders, breadcrumbs, file movement and existing scratchpad/editor routes.

Prism 0.7.0, source digest a145cd7af00c9b18e3f6ff29b3c1f746f4dad21487d80c306f832a4c7fda45f4. Reference: Prism drawings-dashboard prototype, SHA-256 9d464f4089cc01d35e96a10262e773e67c9c49a518841fa5fc0e34f155143760. Domain source: dashboard/api.ts and data/serverMeta.ts.

## Readiness

Ready. Installed contracts, React declarations and guidance support every control. Hero/SignupForm blocks do not fit this product screen. Native links provide navigation; native layout plus Prism controls compose drawing cards and folder navigation. No new shared API or FPO required.

## Mapping and control inventory

| Region/control | Behavior | Supported mapping | Verification |
| --- | --- | --- | --- |
| Workspace / Drawings | Identity, main landmark | Native header, Page wide | One H1; skip link |
| New drawing / New folder | Create in current folder | Button, Dialog, TextField | Validation, pending, API conflict |
| Search drawings / Sort by | Content search and ordering | SearchField onClear, Select | Debounce, stale response suppression, search failure |
| Recent / Favorites | Related quick-access panels | Tabs, Section | Keyboard, empty panels |
| Drawing preview/title | Open editor | Native link and image | Route and thumbnail fallback |
| Favorite | Persist state | Toggle star, pending | Stable name, repeat request prevention |
| Drawing actions | Rename, move, delete | DropdownMenu icon; Dialog; TextField/Select | Focus, validation, destructive confirmation |
| Folders / breadcrumbs | Nested navigation and drop targets | Native buttons/layout with Prism menus | Nested paths, accessible move alternative |
| Loading/error/empty | Feedback and recovery | Native status, Alert, Empty, Button | Retained content, retry |
| Operation outcomes | Brief outcome | ToastProvider, Toast | Inline required errors retained |
| Scratchpad | Navigate stock editor | Native link | Editor route |

## Gaps and decisions

Drawing cards and folder browsing are new local compositions, not shared components. Use native semantics and registered role utilities; no internal restyling. Prism owns controls; consumer owns services and layout. Compiled Prism CSS is injected once during dashboard lifetime and removed on unmount, with root theme attributes restored. Verify editor coexistence and portal styling. This is a routine stylesheet integration adaptation to preserve the stock editor.

## Verification

- Typecheck passed using the repository TypeScript 5.9 compiler. The script now resolves that compiler explicitly; removed unnecessary baseUrl (path aliases are already relative), allowing the build checker to run under TypeScript 6 as well.
- Dashboard behavior suite: 8 tests passed. Dashboard plus serverStorage focused run: 28 tests passed.
- Full app suite: 113 files passed, 2 failed; 1,519 tests passed, 9 failed. The failures are in editor selection render-count assertions and a container-text layout assertion. Those same 9 failures reproduce when both editor suites run separately; they remain unresolved.
- Changed TypeScript files pass ESLint with no warnings; formatting and diff whitespace checks pass.
- Production build and service worker generation passed. Dashboard is lazy-loaded and imports selected public component subpaths to avoid bundling unrelated Prism capabilities into the editor entry.
- Browser review with intercepted API fixtures: custom nested destination and rename requests verified; nested folder navigation verified; destructive confirmation initially focuses Cancel; favorite Space activation and search clear verified.
- Ready-view WCAG A/AA scans report no violations in light or dark; 390px mobile has no horizontal overflow. Desktop and mobile screenshots inspected.
- Scratchpad route renders editor canvases, removes the dashboard stylesheet, and restores root theme attributes; no browser exceptions in the reviewed journeys.
- Prism consumer check reports no dashboard component/role violations, but cannot pass for the entire selected directory: following DashboardRoot into the existing editor produces monorepo external-source diagnostics. Automated setup also cannot handle an app-owned dependency hoisted to the workspace root. Added a local AGENTS entry pointing to installed release instructions rather than duplicating package dependencies or weakening the checker.
- Root All drawings includes nested drawings to match the approved prototype; selecting a folder limits the library to that folder. Move supports existing folders and a new nested path, retaining the original server capability.

Retained evidence: drawings-dashboard/desktop.png, dark.png, mobile.png. Browser fixture checks exercise the real UI and client code, not filesystem persistence; existing serverStorage tests cover persistence behavior. User acceptance of the final implementation remains separate from these checks.

## Local composition deviation

Drawing cards and folder navigation are consumer-owned compositions in excalidraw-app/dashboard/Dashboard.tsx. They use official Toggle, DropdownMenu, Dialog, Button, TextField and Select alongside native links, images, headings and navigation buttons. Visual roles are background, foreground, card, card-foreground, muted, muted-foreground, accent, accent-foreground and ring. Responsive grids and native drop targets are local layout; no shared Prism API or styling override was added.

Lazy loading follows [React Suspense guidance](https://react.dev/reference/react/Suspense).
