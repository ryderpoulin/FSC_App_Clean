import { z } from "zod";

// Airtable Trip Schema
export const tripSchema = z.object({
  id: z.string(),
  fields: z.object({
    "Trip Name": z.string(),
    "Trip Lead Name": z.string().optional(),
    "Start Date": z.string(),
    "End Date": z.string(),
    "Trip Status": z.enum(["Open", "Waitlist", "Full", "Completed"]).optional(),
    "Capacity (Including leads)": z.number().optional(),
    "Additional Drivers Required": z.number().optional(),
    "Cost of Trip (per-person)": z.array(z.number()).optional(),
    "Type of Trip": z.array(z.string()).optional(),
    "Non-Drivers Capacity": z.number().optional(),
    "FULL": z.string().optional(),
  }),
});

export type Trip = z.infer<typeof tripSchema>;

// Normalized Signup Schema (what the app uses internally)
// Status field preserves exact Airtable values to maintain driver designation and waitlist numbering
export const signupSchema = z.object({
  id: z.string(),
  fields: z.object({
    "Participant Name": z.string(),
    "Trip ID": z.union([z.string(), z.array(z.string())]),
    "Is Driver": z.boolean().optional(),
    // Status values:
    // - Roster: "Selected (driver)" | "Selected (nondriver)" | "ON TRIP" (legacy)
    // - Waitlist: "Waitlist (driver) - N" | "Waitlist (nondriver) - N" | "WAITLIST" (legacy)
    // - Dropped: "Dropped- MM/DD/YYYY"
    // Note: Driver and non-driver waitlists are numbered independently (both start from 1)
    Status: z.string(),
    Email: z.string().email().optional(),
    Phone: z.string().optional(),
  }),
});

export type Signup = z.infer<typeof signupSchema>;

// API Request/Response Types
export const loginRequestSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const randomizeRequestSchema = z.object({
  tripId: z.string(),
});

export type RandomizeRequest = z.infer<typeof randomizeRequestSchema>;

export const addFromWaitlistRequestSchema = z.object({
  tripId: z.string(),
});

export type AddFromWaitlistRequest = z.infer<typeof addFromWaitlistRequestSchema>;

export const addDriverRequestSchema = z.object({
  tripId: z.string(),
});

export type AddDriverRequest = z.infer<typeof addDriverRequestSchema>;

export const addNonDriverRequestSchema = z.object({
  tripId: z.string(),
});

export type AddNonDriverRequest = z.infer<typeof addNonDriverRequestSchema>;

export const reAddParticipantRequestSchema = z.object({
  tripId: z.string(),
  participantId: z.string(),
  participantName: z.string(),
});

export type ReAddParticipantRequest = z.infer<typeof reAddParticipantRequestSchema>;

export const dropParticipantRequestSchema = z.object({
  tripId: z.string(),
  participantId: z.string(),
  participantName: z.string(),
});

export type DropParticipantRequest = z.infer<typeof dropParticipantRequestSchema>;

export const chatRequestSchema = z.object({
  tripId: z.string(),
  message: z.string().min(1, "Message cannot be empty"),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.number(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

// Response Types
export type TripsResponse = {
  trips: Trip[];
};

export type SignupsResponse = {
  signups: Signup[];
  roster: Signup[];
  waitlist: Signup[];
  dropped: Signup[];
  driverCount: number;
};

export type RandomizeResponse = {
  success: boolean;
  message: string;
  proposedRoster: Signup[];
  proposedWaitlist: Signup[];
};

export const approveRandomizationRequestSchema = z.object({
  tripId: z.string(),
  rosterIds: z.array(z.string()),
  waitlistIds: z.array(z.string()),
});

export type ApproveRandomizationRequest = z.infer<typeof approveRandomizationRequestSchema>;

export type ApproveRandomizationResponse = {
  success: boolean;
  message: string;
};

export type AddFromWaitlistResponse = {
  success: boolean;
  message: string;
  addedParticipant?: Signup;
};

export type DropParticipantResponse = {
  success: boolean;
  message: string;
};

export type ChatResponse = {
  message: string;
  action?: {
    type: "randomize" | "add_waitlist" | "drop_participant";
    result: any;
  };
};
