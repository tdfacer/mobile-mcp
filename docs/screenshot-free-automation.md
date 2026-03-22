# Screenshot-Free Mobile Automation: What Clients Must Expose

> **Audience**: Technical readers with backend/AI experience and some mobile knowledge.
> **Goal**: Understand what iOS and Android clients need to expose through their accessibility/UI hierarchy APIs so that an LLM agent can control a device purely through structured data — no screenshots required.

---

## The Core Problem

Mobile-mcp can control devices in two ways:

1. **Structured (preferred)** — Read the UI hierarchy tree, find elements by their attributes, tap/swipe by coordinates derived from those elements.
2. **Visual fallback** — Take a screenshot, send it to the LLM, let the model figure out where things are visually.

Screenshots are expensive: they consume a lot of tokens, add latency, and require the LLM to do visual reasoning that should be unnecessary if the app is properly instrumented. The goal is to **never need the visual fallback**.

The fallback is triggered when the structured hierarchy is missing, ambiguous, or incomplete — meaning the agent can't confidently identify what's on screen or where to tap without seeing a picture.

---

## How the Hierarchy Works Today

### Android (UIAutomator)

Android exposes a UI hierarchy via `uiautomator dump`, which produces an XML tree of `<node>` elements. Each node represents a visible UI widget.

**Attributes currently available:**

| Attribute | Maps to | Notes |
|-----------|---------|-------|
| `class` | element type | e.g. `android.widget.Button` |
| `text` | visible label | The text the user sees |
| `content-desc` | accessibility label | Set by developer for screen readers |
| `hint` | placeholder text | e.g. "Enter email..." |
| `resource-id` | stable identifier | e.g. `com.example.app:id/submit_btn` |
| `bounds` | coordinates | `[left,top][right,bottom]` |
| `focused` | focus state | boolean |
| `checkable` | toggle state | boolean — used for checkboxes, switches |

Mobile-mcp filters this down and returns: `type`, `text`, `label`, `name`, `value`, `identifier`, `rect`, `focused`.

### iOS (WebDriverAgent / WDA)

iOS exposes a hierarchy via WDA's `/source?format=json` endpoint, returning a nested JSON tree.

**Attributes currently available:**

| Attribute | Maps to | Notes |
|-----------|---------|-------|
| `type` | element type | e.g. `Button`, `TextField`, `Switch` |
| `label` | accessibility label | What VoiceOver reads aloud |
| `name` | element name | Often matches label |
| `value` | current value | Dynamic — text field content, switch state |
| `rawIdentifier` | test/stable ID | Set by developer via `accessibilityIdentifier` |
| `rect` | bounding box | `{x, y, width, height}` |
| `isVisible` | visibility | `"0"` or `"1"` |

---

## Why Screenshots Are Still Needed

Screenshots become necessary when the hierarchy data fails in any of the following ways:

### 1. Elements Have No Useful Text or Label

An agent needs to understand **what** an element is before it can decide to tap it. If a button has no `text`, no `content-desc`/`label`, and no meaningful `resource-id`, the agent has no way to identify it without seeing a picture.

**What clients must expose:**
- Every interactive element **must** have either a visible text label or an accessibility label.
- On Android: set `android:contentDescription` on all `ImageButton`, `ImageView`, and icon-only views.
- On iOS: set `.accessibilityLabel` on all custom views, icon buttons, and any element that doesn't naturally have readable text.

### 2. Elements Have No Stable Identifier

Without a stable identifier, the agent must use text or visual position to re-find elements across interactions. Text can change (localization, dynamic content), and positions shift. This forces screenshot-based coordinate guessing.

**What clients must expose:**
- On Android: assign `android:id` to every interactive element. The `resource-id` is the durable anchor.
- On iOS: set `.accessibilityIdentifier` on every interactive view. This shows up as `rawIdentifier` in WDA and survives label/text changes.

Think of these like HTML `id` attributes — they're for automation, not users.

### 3. Elements Are Not in the Accessibility Tree at All

Custom-rendered views (game UIs, canvas/OpenGL, some React Native and Flutter builds, web content in a `WebView`) may not appear in the native accessibility hierarchy at all. The tree exists, but it either shows a single opaque container or shows nothing useful.

**What clients must expose:**
- For React Native: use `accessible={true}` and `accessibilityLabel` on touchable components. React Native maps these to native accessibility APIs.
- For Flutter: use `Semantics` widgets to annotate interactive elements.
- For WebViews: the web content must itself have proper ARIA labels and roles — the native hierarchy doesn't help here.
- For fully custom rendering (game engines, canvas): this is the hardest case. The app must either implement a custom accessibility overlay or accept that screenshot mode is required.

### 4. Element State Is Not Reflected

An agent needs to know the **current state** of a UI element to make decisions: Is a checkbox checked? Is a toggle on or off? Is a text field filled? If state is missing, the agent may need a screenshot to visually assess the current condition before acting.

**What clients must expose:**
- On Android: `checkable` + `checked` attributes on `CheckBox`, `Switch`, `RadioButton`, `ToggleButton`. The `text` or `content-desc` should not be the only way to know state.
- On iOS: the `value` field must be populated. For a `Switch`, WDA returns `value: "1"` (on) or `value: "0"` (off). For a `TextField`, `value` should be the current text. These must not be empty or stale.

### 5. Coordinates / Bounds Are Missing or Wrong

The agent taps by center-point coordinate derived from `bounds`/`rect`. If this is missing, zero, or wrong (elements that are off-screen but still in the hierarchy), the tap lands in the wrong place and the agent falls back to screenshot to find the real location.

**What clients must expose:**
- Every visible element must have accurate, non-zero bounds.
- Elements that are off-screen or behind other elements should either be excluded from the dump or clearly marked as not visible (`isVisible: "0"` on iOS; zero-area bounds on Android).
- Scrollable containers: the agent needs to know scroll position and that more content exists below the fold — this is usually only available through the `scrollable` attribute on Android (`RecyclerView`, `ScrollView`) and through WDA on iOS.

### 6. Hierarchy Is Too Deep or Too Noisy

UIAutomator dumps can include hundreds of nodes — decorative dividers, invisible layout containers, duplicate wrappers. An LLM has a finite context window. When the tree is 800 nodes deep with 600 invisible containers, the signal-to-noise ratio drops, the useful elements get lost, and the agent may need a screenshot to understand what's actually visible.

**What clients must expose (or rather, suppress):**
- Purely structural layout containers (`LinearLayout`, `FrameLayout`, `ConstraintLayout`, `View`) with no user-facing purpose should ideally have `importantForAccessibility="no"` set, which removes them from the dump.
- On iOS, WDA already filters somewhat, but apps using view controllers as pure layout wrappers should use `accessibilityElementsHidden = true` on container views.
- The goal: the accessibility tree should reflect the **logical UI**, not the implementation's view hierarchy.

---

## The Ideal Hierarchy Element

Here's what a "perfect" element looks like from the agent's perspective:

### Android (ideal UIAutomator node)
```xml
<node
  class="android.widget.Button"
  text="Confirm Order"
  content-desc="Confirm your order"
  resource-id="com.example.app:id/confirm_button"
  bounds="[80,1200][640,1280]"
  enabled="true"
  clickable="true"
  focused="false"
/>
```

What makes this ideal:
- `text` + `content-desc` → agent knows what this element is
- `resource-id` → stable identifier for re-finding
- `bounds` → accurate coordinates for tapping
- `clickable="true"` → agent knows this is interactive without guessing

### iOS (ideal WDA element)
```json
{
  "type": "Button",
  "label": "Confirm Order",
  "name": "Confirm Order",
  "value": "",
  "rawIdentifier": "confirm_order_button",
  "rect": { "x": 80, "y": 1200, "width": 560, "height": 80 },
  "isVisible": "1"
}
```

What makes this ideal:
- `label` + `name` → agent knows what this is
- `rawIdentifier` → set by developer, stable across localization
- `rect` → accurate and positive
- `isVisible: "1"` → agent knows it's on screen

---

## Summary: The Client Checklist

For an LLM agent to control a mobile app without screenshots, app developers/clients must ensure:

| Requirement | Android | iOS |
|-------------|---------|-----|
| All interactive elements have human-readable labels | `android:contentDescription` on icon-only views | `.accessibilityLabel` on all interactive views |
| All interactive elements have stable identifiers | `android:id` (→ `resource-id`) | `.accessibilityIdentifier` (→ `rawIdentifier`) |
| Elements show accurate bounds | Default behavior if views are properly laid out | Default if views are standard UIKit; custom renderers must override |
| State is reflected in the tree | `checked`, `enabled`, `selected` attributes are set | `value` field reflects current state |
| Off-screen elements are excluded or flagged | Ensure `visibility=GONE` elements aren't dumped | `isVisible: "0"` filtered by WDA |
| Structural noise is suppressed | `importantForAccessibility="no"` on pure layout containers | `accessibilityElementsHidden = true` on wrappers |
| Custom renders expose accessibility | Custom `AccessibilityNodeProvider` for canvas/game views | `accessibilityElements` array on custom views |

---

## The Framework-Specific Reality

| Framework | Native A11y Support | Practical Reality |
|-----------|--------------------|--------------------|
| Native Android (XML) | Excellent | Works well if devs set IDs and content-desc |
| Native iOS (UIKit) | Excellent | Works well if devs set accessibilityIdentifier |
| React Native | Good | Requires explicit `accessible` + `accessibilityLabel` props |
| Flutter | Moderate | `Semantics` widget required; not always used |
| Xamarin/MAUI | Moderate | Platform-specific annotations still needed |
| WebView (mobile) | Poor | Depends on web ARIA; native hierarchy shows a single blob |
| Game engines (Unity, Unreal) | None by default | Custom overlay or screenshot-only |

---

## Bottom Line

**Screenshots are the accessibility tax on apps that don't invest in their accessibility tree.**

If every interactive element has a label, a stable ID, accurate bounds, and current state — and if structural noise is suppressed — then an LLM agent can fully control the device with structured data alone. The agent can answer "what's on screen?", "where is the submit button?", and "is this toggle on?" entirely from the hierarchy, with zero pixels.

The investment required is identical to what's needed for good screen reader support (VoiceOver on iOS, TalkBack on Android). Apps that are already accessible for users with disabilities are, by definition, close to being automatable without screenshots.
