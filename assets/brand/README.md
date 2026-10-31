# Brand assets

Logo directions for RoboCop AI. Not used anywhere in the app yet.

| Folder | Direction | Ground |
|---|---|---|
| `lead-line/` | Lens with a rising signal line, alert dot ahead of the peak | dark |
| `watchpoint/` | Soft frame corners around a checkmark, safety and help | light |
| `early-peak/` | Signal line with a marker just before the spike | dark |

Each folder has `mark.svg`, `lockup.svg` (mark + wordmark), app icons and `favicon.svg`.

The lockups use live text, not outlined paths. They render with the named
Google Font if it is loaded (JetBrains Mono, Nunito, Archivo) and fall back
to a system font otherwise. Outline the text before using a lockup in print
or anywhere fonts can't be loaded.
