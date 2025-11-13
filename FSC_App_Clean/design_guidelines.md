# Field Studies Trip Manager - Design Guidelines

## Design Approach

**Selected Framework:** Design System Approach - Tailwind UI Patterns
**Justification:** This is a utility-focused internal dashboard requiring efficiency, clarity, and familiarity. Trip leads need to quickly scan rosters, make decisions, and take actions without visual distractions.

**Core Principles:**
1. **Clarity First:** Information hierarchy supports quick scanning of trip data, rosters, and waitlists
2. **Action-Oriented:** Clear CTAs for roster management operations
3. **Trustworthy:** Clean, professional aesthetic befitting trip safety management
4. **Efficient:** Minimal clicks between dashboard → trip details → actions

---

## Typography

**Font Family:** Inter (Google Fonts)
- Primary: Inter Regular (400), Medium (500), Semibold (600), Bold (700)

**Hierarchy:**
- Page Titles: text-3xl font-bold (Dashboard, Trip Name)
- Section Headers: text-xl font-semibold (Roster, Waitlist, Drivers)
- Card Titles: text-lg font-medium (Trip names in dashboard)
- Body Text: text-base font-normal (participant names, dates)
- Labels: text-sm font-medium uppercase tracking-wide (Status badges, metadata)
- Helper Text: text-sm (counts, timestamps)

---

## Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, 8, 12, 16
- Component padding: p-6 or p-8
- Section gaps: space-y-6 or space-y-8
- Card spacing: gap-4 or gap-6
- Button padding: px-6 py-3

**Container Strategy:**
- Max-width containers: max-w-7xl mx-auto px-4 sm:px-6 lg:px-8
- Dashboard cards grid: grid gap-6 md:grid-cols-2 lg:grid-cols-3
- Content sections: space-y-8

---

## Component Library

### Authentication (Login Page)
- **Layout:** Full-screen centered with min-h-screen flex items-center justify-center
- **Background:** Gradient overlay treatment
- **Card:** Frosted glass effect with backdrop-blur, rounded-2xl, max-w-md width, p-8 spacing
- **Input Field:** Large (h-12), rounded-lg border, focus ring treatment
- **Submit Button:** Full width, h-12, rounded-lg, font-semibold
- **Logo/Branding:** Include "Field Studies" wordmark, text-2xl font-bold at top of card

### Dashboard
- **Header Bar:** Sticky top positioning, backdrop-blur, border-b, py-4
  - Left: "Field Studies Trip Manager" title (text-xl font-bold)
  - Right: Logout action
- **Trip Cards:** 
  - Rounded-xl with border and subtle shadow (shadow-sm hover:shadow-md transition)
  - Padding: p-6
  - Structure: Trip name header, date range, status badge, action button footer
  - Status Badge: Inline-flex items-center, px-3 py-1, rounded-full, text-sm font-medium
  - "Manage Trip" button: Secondary style, w-full at card bottom

### Trip Detail Page
- **Page Header:**
  - Back navigation arrow (← Back to Dashboard)
  - Trip name (text-3xl font-bold)
  - Date range (text-lg)
- **Content Grid:** Two-column on desktop (grid lg:grid-cols-3 gap-8)
  - Left column (lg:col-span-2): Roster and Waitlist sections
  - Right column: Action buttons + Stats card
- **Roster/Waitlist Sections:**
  - Section header with count badge
  - List items: flex justify-between items-center, py-3, border-b
  - Participant name on left, driver indicator/actions on right
- **Action Buttons Panel:**
  - Stacked vertical layout (space-y-4)
  - Each button: w-full, h-12, rounded-lg, font-medium, justify-center
  - Primary action style for "Randomize Roster"
  - Secondary styles for "Add from Waitlist" and "Drop Participant"
- **Stats Card:**
  - Rounded-lg border, p-6
  - Display: Total signups, Current roster count, Drivers count
  - Each stat: text-sm label above, text-2xl font-bold number

### ChatBox (AI Assistant)
- **Position:** Fixed bottom-right, mb-6 mr-6, max-w-md width
- **Container:** Rounded-2xl, border, shadow-xl, overflow-hidden
- **Header Bar:** 
  - px-6 py-4, border-b
  - "AI Trip Assistant" title, text-lg font-semibold
  - Toggle minimize/expand button
- **Message Area:**
  - h-80 overflow-y-auto, p-6, space-y-4
  - User messages: align right, rounded-2xl rounded-tr-sm, px-4 py-3, max-w-[80%] ml-auto
  - AI messages: align left, rounded-2xl rounded-tl-sm, px-4 py-3, max-w-[80%] mr-auto
- **Input Section:**
  - border-t, p-4
  - Flex layout: input field (flex-1) + send button
  - Input: h-10, rounded-lg, px-4
  - Send button: h-10, px-6, rounded-lg, font-medium

### Modals/Dialogs (for Drop Participant)
- **Overlay:** Fixed inset-0, backdrop-blur-sm
- **Modal Card:** Centered, max-w-md, rounded-2xl, p-6
- **Structure:** Icon at top, title, description text, action buttons (flex gap-3)

---

## Loading & Empty States
- **Loading Spinner:** Centered, animate-spin, w-8 h-8
- **Empty State:** Centered text-center, p-12
  - Icon (w-12 h-12 mx-auto mb-4)
  - "No trips found" heading
  - Subtle helper text below

---

## Interaction Patterns
- **Hover States:** shadow-sm → shadow-md transitions, opacity changes
- **Focus States:** Ring utility classes (focus:ring-2 focus:ring-offset-2)
- **Button Disabled:** Opacity-50, cursor-not-allowed
- **Success Feedback:** Toast notifications (top-right, rounded-lg, slide-in animation)
- **Error States:** Border-red and text-red variants, with icon indicators

---

## Responsive Behavior
- **Mobile (<768px):** Single column, stacked cards, full-width buttons, sticky bottom chatbox
- **Tablet (768-1024px):** Two-column grid for dashboard cards
- **Desktop (>1024px):** Three-column dashboard grid, two-column trip detail layout