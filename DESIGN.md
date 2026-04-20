# Active Acquisitions — Design System Reference

> **This document governs all UI decisions for ActiveAcq.**
> Every future CSS change, component addition, or layout decision must be checked against this reference first.

---

## Brand Identity & Inspiration

### The Container

The single most important design artifact is the **orange shipping container pen holder** that sits on every team member's desk. It was custom-made for Active Acquisitions and encodes everything about the brand:

- **Bold without being loud** — a physical object that commands a desk but doesn't shout
- **Industrial precision** — construction industry roots, real buildings, real money, real stakes
- **Team belonging** — everyone has one; this is *their* software, not a generic tool
- **Two oranges working together** — the warm amber body and the deeper terracotta logo lettering

When Seth sees the UI, he should recognize the container. The ridges, the warmth, the structure. Not as a gimmick — as a feeling.

### Brand Personality
- **Sophisticated but bold** — boardroom-ready, not startup-casual
- **Industrial precision** — like a well-organized job site, everything has its place
- **Warm confidence** — not cold tech gray, warm like the office, the desk, the team

---

## Color System

### Primary Palette

| Token | Value | Usage |
|---|---|---|
| `--accent` | `#c4522a` | Primary actions, buttons, active states, focus rings |
| `--accent-hover` | `#b04824` | Button hover, pressed states |
| `--accent-dim` | `rgba(196,82,42,0.08)` | Hover backgrounds, subtle fills |
| `--accent-light` | `#fdf3ef` | Selected rows, active backgrounds |
| `--amber` | `#e8921a` | Secondary warmth — progress fills, highlight accents, burn bars |
| `--amber-dim` | `rgba(232,146,26,0.12)` | Amber tint backgrounds |

### Background & Surface (Warm, not cold)

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#faf8f5` | Page background — warm off-white, like the office desk |
| `--surface` | `#ffffff` | Cards, panels, modals |
| `--surface-2` | `#f7f5f2` | Alternate rows, secondary areas |
| `--surface-3` | `#f0ede8` | Deeply inset areas, disabled states |

### Sidebar (Dark, warm charcoal — not cold navy)

The sidebar is the one dark element. It is NOT cold blue-navy. It is warm dark charcoal — like structural steel with warmth.

| Element | Value |
|---|---|
| Sidebar base | `#c4522a` (brand terracotta — the logo color) |
| Ridge texture | dark shadow ridges on orange: `rgba(0,0,0,0.06)` stripes + `rgba(255,255,255,0.03)` highlight |
| Active item bg | `rgba(255,255,255,0.92)` — white pill |
| Active item color | `var(--accent)` terracotta — clean inversion |
| Hover item bg | `rgba(0,0,0,0.12)` |
| Section label | `rgba(255,255,255,0.5)` |

### Semantic Colors

| State | Color | Background | Border |
|---|---|---|---|
| OK / Paid | `#059669` | `#ecfdf5` | `#a7f3d0` |
| Warning | `#d97706` | `#fffbeb` | `#fde68a` |
| Danger | `#dc2626` | `#fef2f2` | `#fecaca` |
| Info | `#2563eb` | `#eff6ff` | `#bfdbfe` |

---

## Typography

**Primary font:** Inter (400, 500, 600, 700)  
**Monospace (numbers):** SF Mono, ui-monospace, Fira Code, Consolas

### Key Type Decisions
- Financial figures use `font-variant-numeric: tabular-nums` — columns must align
- Section labels: `10–11px`, `600` weight, `0.1em` letter-spacing, uppercase — **stencil feel**
- Page titles: `22px`, `700` weight, `-0.02em` tracking — bold, not decorative
- Form labels: `11.5px`, `600` weight, `0.04em` tracking, uppercase

---

## The Container Details — Translated to UI

These are the physical-world references and their exact UI equivalents. Maintain them.

### 1. Vertical Corrugation Ridges → Sidebar Texture
The container's corrugated ribs run vertically. The sidebar has a matching subtle vertical stripe pattern.
```css
background-image: repeating-linear-gradient(
  90deg,
  transparent 0px, transparent 18px,
  rgba(255,255,255,0.022) 18px, rgba(255,255,255,0.022) 20px
);
```
**Rule:** Never remove the sidebar ridge texture. It is the primary Easter egg for Seth.

### 2. Corner Hardware Brackets → Card Corner Accents
Container corners have structural steel brackets. Cards use small `L`-shaped orange corner marks via `::before`/`::after`.
- Size: 10px legs, 2px stroke
- Color: `var(--accent)` at `0.5` opacity normally, `1.0` on hover
- Position: top-left corner of `.panel` and `.project-card`

### 3. Panel Seams → Section Dividers
Container panels are separated by a seam with a slight shadow. Section dividers use a double-line treatment: `1px solid var(--border)` with a 1px gap above.

### 4. Stencil Lettering → Section Labels
The ACTIVE ACQUISITIONS text on the container is bold, wide-tracked, uppercase stencil. All uppercase labels in the UI echo this — wider letter-spacing (`0.1em`), heavier weight (`600`), no decorative elements.

### 5. Measurement Markings → Progress Bar Tick
The load-line on a container marks maximum capacity. The burn bar's initial contract tick mark (`|`) is this reference — it marks where the vendor said they'd stop.

### 6. Two Oranges → Two-Tone Accent System
- **Terracotta** (`#c4522a`): Action — buttons, links, active states, focus
- **Amber** (`#e8921a`): Warmth — progress bar fills, burn bar, highlight backgrounds

---

## Component Rules

### Sidebar
- Always dark warm charcoal `#1c1814`, never cold navy
- Always has ridge texture
- Logo area has a bottom border `rgba(255,255,255,0.07)` — container edge seam
- Active items: orange glow, no sharp contrast
- Login screen background matches sidebar color

### Cards & Panels
- Background: `var(--surface)` white
- Border: `1px solid var(--border)` — `#e8e3dc` (warm, not cold gray)
- Corner accent: small orange `L` bracket — optional on hover
- Radius: `12px` panels, `10px` smaller cards, `8px` stat cells
- Shadow: `var(--shadow)` — subtle, never deep

### Progress / Burn Bars
- Scale line: `var(--surface-3)` warm gray track
- Paid segment: `var(--ok)` green
- Outstanding / invoiced segment: amber `#e8921a`
- Committed / pending: `var(--accent)` terracotta at `0.8` opacity
- Initial contract tick: white `|` marker at exact percentage position

### Tables
- Header background: `var(--surface-2)` warm off-white
- Row hover: `#f7f4f0` (warm, not cold blue-gray)
- Border color: `var(--border)` warm

### Buttons
- Primary: terracotta `#c4522a` fill, white text, subtle orange shadow
- Default: white surface, warm border, no cold grays
- Danger: white surface, red text/border

### Badges / Status Pills
- Same semantic colors as before, but `pending` badge uses warm gray `#f5f2ee` base

### Modals
- Backdrop: `rgba(28,24,20,0.5)` — warm dark, not cold blue-black
- Panel: white surface, warm border

### Tooltips (`[data-tip]`)
- Background: `#1c1814` (matches sidebar — same warm charcoal)
- Text: `#f9fafb`
- Arrow: matching charcoal

---

## What Never Changes

1. **The sidebar ridge texture** — always present, the container signature
2. **Warm backgrounds** — `--bg` is always warm off-white, never cold gray
3. **Two orange tones** — terracotta for action, amber for warmth/fills
4. **Sidebar charcoal** — `#1c1814`, never cold navy
5. **Tabular numerals** — all financial figures align in columns
6. **Section labels** — always uppercase, wide-tracked, stencil-feel

---

## What Never Gets Added

- Drop shadows deeper than `var(--shadow-md)` on content cards
- Blue as a brand color (info only, never primary)
- Cold gray backgrounds (anything with blue-gray cast)
- Rounded corners larger than `14px`
- Decorative illustrations or icons beyond functional symbols
- Gradients except in the sidebar texture and burn bar segments

---

*Last updated: 2026-04-20*  
*Inspired by: the orange shipping container on everyone's desk.*
