# UI Conventions

## Shared components

Use these components before adding business-page styles:

- `PageLayout`, `PageHeader`
- `AppPanel`, `AppCard`
- `AppButton`, `AppTabs`
- `AppInput`, `AppSelect`, `AppSelectField`
- `StatusPill`, `EmptyState`, `AppConfirmDialog`
- `PathPickerPanel`, `ImageCompareSlider`

Use `AppSelectField` for labeled selects. Reserve raw `AppSelect` for shared component internals and unlabeled compact controls.

## Layout

- Keep page headers compact: Chinese title, one-line description, optional actions.
- Keep image and audio path pickers compact so logs remain visible.
- Keep settings tabs ordered: appearance, compression, image, backup.
- Put TinyPNG Key management before image-engine settings.

## Styling

- Keep light and dark overrides in shared CSS or base components.
- Do not add business-page `bg-white/*`, direct surface colors, or raw `<select>` elements.
- Use shared button variants and confirm dialogs for destructive actions.
- Verify desktop and narrow layouts and confirm text remains readable in dark mode.
