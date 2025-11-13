# Field Studies Trip Manager

## Overview

Field Studies Trip Manager is an internal web application for managing overnight trips for a student-led outdoor organization at Cal Poly SLO. The application enables trip leads to view upcoming trips, manage participant rosters, and handle waitlists. It supports hiking, backpacking, and climbing trip coordination with features like randomized roster selection, driver slot management, and waitlist-to-roster promotion.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript and Vite as the build tool

**Routing**: Wouter (lightweight client-side routing library)
- Rationale: Minimal overhead compared to React Router while providing necessary routing functionality for a small application with 3 main routes (login, dashboard, trip detail)

**State Management**: TanStack Query (React Query)
- Handles server state synchronization and caching
- Eliminates need for global state management library
- Provides automatic background refetching and optimistic updates

**UI Component Library**: shadcn/ui with Radix UI primitives
- Built on Tailwind CSS with custom design tokens
- Provides accessible, customizable components
- Follows "new-york" style variant as specified in components.json

**Styling Approach**: Tailwind CSS with custom design system
- Design philosophy: Utility-focused internal dashboard prioritizing clarity and efficiency
- Custom color palette with semantic tokens (primary, secondary, muted, destructive, accent)
- Typography system using Inter font family from Google Fonts
- Spacing primitives based on Tailwind's default scale

**Authentication Pattern**: Client-side localStorage-based session
- Simple shared password authentication (hardcoded: "fieldstudies2025")
- Session persistence via localStorage key "fieldstudies_auth"
- Protected routes using ProtectedRoute wrapper component
- Rationale: Internal tool with low security requirements; prioritizes simplicity over robust auth

### Backend Architecture

**Server Framework**: Express.js on Node.js
- ESM module system (type: "module" in package.json)
- Middleware: JSON body parsing with raw body preservation for webhook verification
- Request logging with duration tracking for API endpoints

**API Design**: RESTful HTTP endpoints under /api namespace
- `/api/airtable/trips` - Fetch all trips
- `/api/airtable/trips/:id` - Fetch single trip
- `/api/airtable/signups/:tripId` - Fetch signups for a trip
- `/api/airtable/randomize` - Generate proposed roster without committing changes
- `/api/airtable/approve-randomization` - Commit proposed roster changes to Airtable
- `/api/airtable/addFromWaitlist` - Intelligently promote waitlist participant based on available spots (driver vs non-driver), with capacity checks
- `/api/airtable/drop-participant` - Update participant status to "Dropped- [date]"

**Development Setup**: Custom Vite middleware integration
- HMR (Hot Module Replacement) enabled in development
- SSR-style HTML template serving with Vite transformations
- Production: Serves static built files from dist/public

**Validation**: Zod schemas for request/response validation
- Schema definitions in shared/schema.ts for type safety across client/server boundary
- Runtime validation and TypeScript type inference

### Data Storage Solutions

**Primary Database**: Airtable (headless CMS/database via REST API)
- Two main tables:
  - Trips table: Stores trip information (name, dates, status, capacity, driver slots)
  - Signups table: Participant registrations linked to trips via "Trip ID" field
- Rationale: No-code database solution allowing non-technical staff to manage data directly; excellent for small-scale applications with changing schemas

**Schema Design**:
- Trip fields: Trip Name, Trip Lead Name, Start Date, End Date, Trip Status (enum), Capacity (Including leads), Additional Drivers Required, Cost of Trip (per-person), Type of Trip, Non-Drivers Capacity, FULL
- Signup fields: Participant Name, Trip ID (foreign key), Is Driver (boolean), Status (string), Email, Phone
- Status values:
  - Roster: "Selected (driver)" or "Selected (nondriver)"
  - Waitlist: "Waitlist (driver) - #" or "Waitlist (nondriver) - #" (numbered separately)
  - Dropped: "Dropped- MM/DD/YYYY"
  - Legacy: "ON TRIP", "WAITLIST" (still supported for backward compatibility)
- Status workflow: Open → Waitlist → Full → Completed
- Roster filtering: Participants with status containing "on trip" or "selected" (case-insensitive)
- Waitlist filtering: Participants with status containing "waitlist" (case-insensitive)
- Drop participant behavior: Updates status to "Dropped- [date]" instead of deleting the record

**Session Storage**: In-memory storage (MemStorage class)
- User data stored in Map structure with UUID keys
- Rationale: Lightweight session management for simple auth; data loss on restart acceptable for this use case

**Configuration**: Environment variables for Airtable credentials
- AIRTABLE_API_KEY
- AIRTABLE_BASE_ID
- AIRTABLE_TRIPS_TABLE
- AIRTABLE_SIGNUPS_TABLE

### External Dependencies

**Airtable API**:
- RESTful API for CRUD operations on trips and signups
- Authentication: Bearer token via API key
- Base URL pattern: `https://api.airtable.com/v0/{BASE_ID}/{TABLE_NAME}`
- Used for all persistent data storage and retrieval

**Neon Serverless PostgreSQL**:
- Driver: @neondatabase/serverless
- ORM: Drizzle ORM with drizzle-zod for schema validation
- Configuration: drizzle.config.ts using DATABASE_URL environment variable
- Schema location: shared/schema.ts
- Migrations output: ./migrations directory
- Note: Infrastructure configured but not actively used; may be for future expansion or alternative storage

**Third-party UI Libraries**:
- Radix UI primitives for accessible component foundations
- Embla Carousel for potential carousel functionality
- React Hook Form with @hookform/resolvers for form validation
- date-fns for date formatting and manipulation
- lucide-react for icon system

**Development Tools**:
- Replit-specific plugins for development environment (@replit/vite-plugin-runtime-error-modal, @replit/vite-plugin-cartographer, @replit/vite-plugin-dev-banner)
- tsx for TypeScript execution in development
- esbuild for production server bundling