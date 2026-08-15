# @deepseek-ai/dsh-client-ui-settings-model-routing

English | [中文](README.zh.md)

Model Routing settings page for the first-version hierarchical routing: binds one concrete
**Light Model** and one **Expert Model** (picked from the existing `llm.models` catalog) and
the Auto/Manual reasoning-effort mode, writing through the existing `settings.describe` /
`settings.mutate` wire into the `h-model-routing` settings namespace.

## Slots

Registers one `settings.section` entry with id `model-routing` (order 20).

## Model Experience

None, as the section renders a browser configuration UI; the host h-model-routing plugin it configures owns every model-visible effect.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Catalog models only** — the pickers list what adapters advertise; a hand-configured route an adapter does not describe is not selectable here.
- **No reachability validation** — the page validates nothing beyond the wire; an unserviceable binding degrades at request time.
