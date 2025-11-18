// server/index.ts
import express2 from "express";

// server/routes.ts
import { createServer } from "http";
import pLimit from "p-limit";
import { format } from "date-fns";

// server/lib/airtable.ts
var AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
var AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
var TRIPS_TABLE = process.env.AIRTABLE_TRIPS_TABLE;
var SIGNUPS_TABLE = process.env.AIRTABLE_SIGNUPS_TABLE;
var AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
var headers = {
  Authorization: `Bearer ${AIRTABLE_API_KEY}`,
  "Content-Type": "application/json"
};
function normalizeSignup(rawSignup) {
  const fields = rawSignup.fields;
  const normalizedStatus = fields.Status || "UNKNOWN";
  const hasCar = fields["Do you have a car? (from Slack Name)"]?.some(Boolean) || false;
  const phoneArray = fields["Emergency Contact Phone Number (from Participant Info)"] || [];
  const phone = phoneArray.find((p) => p && p.trim()) || void 0;
  return {
    id: rawSignup.id,
    fields: {
      "Participant Name": fields["Slack Name Refined"] || "Unknown",
      "Trip ID": fields["Trip LeadName"] || [],
      "Is Driver": hasCar,
      Status: normalizedStatus,
      Email: fields["Personal Email"],
      Phone: phone
    }
  };
}
async function fetchTrips() {
  const response = await fetch(`${AIRTABLE_BASE_URL}/${encodeURIComponent(TRIPS_TABLE)}`, {
    headers
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch trips: ${error}`);
  }
  const data = await response.json();
  return data.records;
}
async function fetchTripById(tripId) {
  const response = await fetch(
    `${AIRTABLE_BASE_URL}/${encodeURIComponent(TRIPS_TABLE)}/${tripId}`,
    { headers }
  );
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch trip: ${error}`);
  }
  return await response.json();
}
async function fetchTripSignups(tripId) {
  let allRawSignups = [];
  let offset = void 0;
  do {
    const url = offset ? `${AIRTABLE_BASE_URL}/${encodeURIComponent(SIGNUPS_TABLE)}?offset=${offset}` : `${AIRTABLE_BASE_URL}/${encodeURIComponent(SIGNUPS_TABLE)}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch signups: ${error}`);
    }
    const data = await response.json();
    allRawSignups = allRawSignups.concat(data.records);
    offset = data.offset;
  } while (offset);
  const filtered = allRawSignups.filter((signup) => {
    const signupTripIds = signup.fields["Trip LeadName"];
    if (Array.isArray(signupTripIds)) {
      return signupTripIds.includes(tripId);
    }
    return false;
  });
  return filtered.map(normalizeSignup);
}
async function updateSignup(signupId, updates) {
  const airtableUpdates = {};
  if (updates.Status !== void 0) {
    if (updates.Status === "Roster") {
      airtableUpdates.Status = "ON TRIP";
    } else if (updates.Status === "Waitlist") {
      airtableUpdates.Status = "WAITLIST";
    } else {
      console.log(`[updateSignup] Setting Airtable status to: ${updates.Status}`);
      airtableUpdates.Status = updates.Status;
    }
  }
  const response = await fetch(
    `${AIRTABLE_BASE_URL}/${encodeURIComponent(SIGNUPS_TABLE)}/${signupId}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ fields: airtableUpdates })
    }
  );
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update signup: ${error}`);
  }
  const rawUpdated = await response.json();
  return normalizeSignup(rawUpdated);
}

// shared/schema.ts
import { z } from "zod";
var tripSchema = z.object({
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
    "FULL": z.string().optional()
  })
});
var signupSchema = z.object({
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
    Phone: z.string().optional()
  })
});
var loginRequestSchema = z.object({
  password: z.string().min(1, "Password is required")
});
var randomizeRequestSchema = z.object({
  tripId: z.string()
});
var addFromWaitlistRequestSchema = z.object({
  tripId: z.string()
});
var addDriverRequestSchema = z.object({
  tripId: z.string()
});
var addNonDriverRequestSchema = z.object({
  tripId: z.string()
});
var reAddParticipantRequestSchema = z.object({
  tripId: z.string(),
  participantId: z.string(),
  participantName: z.string()
});
var dropParticipantRequestSchema = z.object({
  tripId: z.string(),
  participantId: z.string(),
  participantName: z.string()
});
var chatRequestSchema = z.object({
  tripId: z.string(),
  message: z.string().min(1, "Message cannot be empty")
});
var chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.number()
});
var approveRandomizationRequestSchema = z.object({
  tripId: z.string(),
  rosterIds: z.array(z.string()),
  waitlistIds: z.array(z.string())
});

// server/routes.ts
var proposedRosters = /* @__PURE__ */ new Map();
var PROPOSAL_TTL = 10 * 60 * 1e3;
function cleanupExpiredProposals() {
  const now = Date.now();
  const entries = Array.from(proposedRosters.entries());
  for (const [tripId, proposal] of entries) {
    if (now - proposal.timestamp > PROPOSAL_TTL) {
      proposedRosters.delete(tripId);
      console.log(`[Cleanup] Removed expired proposal for trip ${tripId}`);
    }
  }
}
setInterval(cleanupExpiredProposals, 60 * 1e3);
async function registerRoutes(app2) {
  app2.get("/api/airtable/trips", async (req, res) => {
    try {
      const trips = await fetchTrips();
      const response = { trips };
      res.json(response);
    } catch (error) {
      console.error("Error fetching trips:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch trips"
      });
    }
  });
  app2.get("/api/airtable/trips/:id", async (req, res) => {
    try {
      const trip = await fetchTripById(req.params.id);
      res.json({ trip });
    } catch (error) {
      console.error("Error fetching trip:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch trip"
      });
    }
  });
  app2.get("/api/airtable/signups/:tripId", async (req, res) => {
    try {
      const signups = await fetchTripSignups(req.params.tripId);
      const roster = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        const isOnRoster = status.includes("selected") || status.includes("on trip");
        const isDropped = status.includes("dropped");
        return isOnRoster && !isDropped;
      });
      const waitlist = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        return status.includes("waitlist");
      });
      const dropped = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        return status.includes("dropped");
      });
      const driverCount = roster.filter((s) => s.fields["Is Driver"]).length;
      const response = {
        signups,
        roster,
        waitlist,
        dropped,
        driverCount
      };
      res.json(response);
    } catch (error) {
      console.error("Error fetching signups:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch signups"
      });
    }
  });
  app2.post("/api/airtable/randomize", async (req, res) => {
    try {
      const validationResult = randomizeRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: validationResult.error });
      }
      const { tripId } = validationResult.data;
      const trip = await fetchTripById(tripId);
      const driverSlotsNeeded = trip.fields["Additional Drivers Required"] || 0;
      const nonDriverSlotsNeeded = trip.fields["Non-Drivers Capacity"] || 0;
      if (driverSlotsNeeded === 0 && nonDriverSlotsNeeded === 0) {
        return res.status(400).json({ error: "Trip has no capacity defined for drivers or non-drivers" });
      }
      const allSignups = await fetchTripSignups(tripId);
      if (allSignups.length === 0) {
        return res.status(400).json({ error: "No participants signed up for this trip" });
      }
      const driverEligible = allSignups.filter((s) => s.fields["Is Driver"] === true);
      const nonDriverEligible = allSignups.filter((s) => s.fields["Is Driver"] !== true);
      const shuffledDrivers = [...driverEligible].sort(() => Math.random() - 0.5);
      const shuffledNonDrivers = [...nonDriverEligible].sort(() => Math.random() - 0.5);
      const selectedAsDrivers = shuffledDrivers.slice(0, driverSlotsNeeded);
      const remainingDriverPool = shuffledDrivers.slice(driverSlotsNeeded);
      let selectedAsNonDrivers = shuffledNonDrivers.slice(0, nonDriverSlotsNeeded);
      let remainingNonDriverPool = shuffledNonDrivers.slice(nonDriverSlotsNeeded);
      const nonDriverSlotsFilled = selectedAsNonDrivers.length;
      let driversUsedAsNonDrivers = [];
      let finalRemainingDriverPool = remainingDriverPool;
      if (nonDriverSlotsFilled < nonDriverSlotsNeeded && remainingDriverPool.length > 0) {
        const neededBackfill = nonDriverSlotsNeeded - nonDriverSlotsFilled;
        driversUsedAsNonDrivers = remainingDriverPool.slice(0, neededBackfill);
        selectedAsNonDrivers = [...selectedAsNonDrivers, ...driversUsedAsNonDrivers];
        finalRemainingDriverPool = remainingDriverPool.slice(neededBackfill);
      }
      const rejectedDrivers = finalRemainingDriverPool;
      const rejectedNonDrivers = remainingNonDriverPool;
      const proposedRoster = [...selectedAsDrivers, ...selectedAsNonDrivers];
      const proposedWaitlist = [...rejectedDrivers, ...rejectedNonDrivers];
      const rosterIds = proposedRoster.map((s) => s.id);
      const waitlistIds = proposedWaitlist.map((s) => s.id);
      proposedRosters.set(tripId, {
        rosterIds,
        waitlistIds,
        timestamp: Date.now()
      });
      console.log(`[Randomize] Proposed roster: ${proposedRoster.length} participants (${selectedAsDrivers.length} drivers, ${selectedAsNonDrivers.length} non-drivers)`);
      console.log(`[Randomize] Proposed waitlist: ${proposedWaitlist.length} participants`);
      console.log(`[Randomize] Proposal stored for trip ${tripId}`);
      const response = {
        success: true,
        message: `Randomized ${proposedRoster.length} participants to roster (${selectedAsDrivers.length} drivers, ${selectedAsNonDrivers.length} non-drivers). Click Approve to commit changes.`,
        proposedRoster,
        proposedWaitlist
      };
      res.json(response);
    } catch (error) {
      console.error("Error randomizing roster:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to randomize roster"
      });
    }
  });
  app2.post("/api/airtable/approve-randomization", async (req, res) => {
    try {
      const validationResult = approveRandomizationRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: validationResult.error });
      }
      const { tripId, rosterIds, waitlistIds } = validationResult.data;
      const storedProposal = proposedRosters.get(tripId);
      if (!storedProposal) {
        return res.status(400).json({
          error: "No pending randomization found",
          details: "Please randomize the roster first, or your proposal has expired (10 minute limit)"
        });
      }
      const rosterIdsSet = new Set(rosterIds);
      const waitlistIdsSet = new Set(waitlistIds);
      const storedRosterSet = new Set(storedProposal.rosterIds);
      const storedWaitlistSet = new Set(storedProposal.waitlistIds);
      const rosterMatches = rosterIds.length === storedProposal.rosterIds.length && rosterIds.every((id) => storedRosterSet.has(id));
      const waitlistMatches = waitlistIds.length === storedProposal.waitlistIds.length && waitlistIds.every((id) => storedWaitlistSet.has(id));
      if (!rosterMatches || !waitlistMatches) {
        return res.status(400).json({
          error: "Approval data does not match randomization",
          details: "The roster/waitlist assignment does not match what was randomized. Please randomize again."
        });
      }
      console.log(`[Approve] Proposal validation passed. Updating ${rosterIds.length} to roster, ${waitlistIds.length} to waitlist`);
      proposedRosters.delete(tripId);
      console.log(`[Approve] Proposal cleared, proceeding with Airtable updates`);
      const signups = await fetchTripSignups(tripId);
      const signupMap = new Map(signups.map((s) => [s.id, s]));
      const rosterUpdates = [];
      rosterIds.forEach((id) => {
        const signup = signupMap.get(id);
        if (signup) {
          const isDriver = signup.fields["Is Driver"];
          const status = isDriver ? "Selected (driver)" : "Selected (nondriver)";
          rosterUpdates.push({ id, status });
        }
      });
      const waitlistDrivers = [];
      const waitlistNonDrivers = [];
      waitlistIds.forEach((id) => {
        const signup = signupMap.get(id);
        if (signup) {
          const isDriver = signup.fields["Is Driver"];
          if (isDriver) {
            waitlistDrivers.push(id);
          } else {
            waitlistNonDrivers.push(id);
          }
        }
      });
      const waitlistUpdates = [];
      waitlistDrivers.forEach((id, index) => {
        const status = `Waitlist (driver) - ${index + 1}`;
        waitlistUpdates.push({ id, status });
      });
      waitlistNonDrivers.forEach((id, index) => {
        const status = `Waitlist (nondriver) - ${index + 1}`;
        waitlistUpdates.push({ id, status });
      });
      const limit = pLimit(2);
      const updateTasks = [];
      rosterUpdates.forEach(({ id, status }) => {
        updateTasks.push(() => updateSignup(id, { Status: status }));
      });
      waitlistUpdates.forEach(({ id, status }) => {
        updateTasks.push(() => updateSignup(id, { Status: status }));
      });
      await Promise.all(updateTasks.map((task) => limit(task)));
      console.log(`[Approve] Successfully updated ${updateTasks.length} signups (${rosterUpdates.length} roster, ${waitlistUpdates.length} waitlist)`);
      const response = {
        success: true,
        message: `Successfully updated roster: ${rosterIds.length} on roster, ${waitlistIds.length} on waitlist`
      };
      res.json(response);
    } catch (error) {
      console.error("Error approving randomization:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to approve randomization"
      });
    }
  });
  app2.post("/api/airtable/addFromWaitlist", async (req, res) => {
    try {
      const validationResult = addFromWaitlistRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: validationResult.error });
      }
      const { tripId } = validationResult.data;
      const trip = await fetchTripById(tripId);
      const maxParticipants = trip.fields["Capacity (Including leads)"] || 0;
      const driverSlots = trip.fields["Additional Drivers Required"] || 0;
      const signups = await fetchTripSignups(tripId);
      const roster = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        const isOnRoster = status.includes("selected") || status.includes("on trip");
        const isDropped = status.includes("dropped");
        return isOnRoster && !isDropped;
      });
      const currentDrivers = roster.filter((s) => s.fields["Is Driver"]).length;
      const currentNonDrivers = roster.length - currentDrivers;
      const currentTotal = roster.length;
      console.log(`[Add from Waitlist] Current roster composition: ${currentTotal}/${maxParticipants} total (${currentDrivers} drivers, ${currentNonDrivers} non-drivers)`);
      console.log(`[Add from Waitlist] Capacity: ${driverSlots} driver slots, ${maxParticipants - driverSlots} non-driver capacity`);
      if (currentTotal >= maxParticipants) {
        return res.status(400).json({
          error: "Roster currently full!",
          details: `Roster is at capacity (${currentTotal}/${maxParticipants})`
        });
      }
      const driverSpotsAvailable = driverSlots - currentDrivers;
      const nonDriverSpotsAvailable = maxParticipants - driverSlots - currentNonDrivers;
      console.log(`[Add from Waitlist] Roster: ${currentTotal}/${maxParticipants}, Drivers: ${currentDrivers}/${driverSlots}, Driver spots available: ${driverSpotsAvailable}, Non-driver spots available: ${nonDriverSpotsAvailable}`);
      const waitlist = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        return status.includes("waitlist");
      });
      if (waitlist.length === 0) {
        return res.status(400).json({ error: "No participants on waitlist" });
      }
      const waitlistDrivers = waitlist.filter((s) => s.fields["Is Driver"]);
      const waitlistNonDrivers = waitlist.filter((s) => !s.fields["Is Driver"]);
      let nextPerson;
      if (driverSpotsAvailable > 0 && nonDriverSpotsAvailable > 0) {
        if (waitlistDrivers.length > 0) {
          nextPerson = waitlistDrivers[0];
          console.log(`[Add from Waitlist] Both spots available, adding driver: ${nextPerson.fields["Participant Name"]}`);
        } else if (waitlistNonDrivers.length > 0) {
          nextPerson = waitlistNonDrivers[0];
          console.log(`[Add from Waitlist] Both spots available, no drivers on waitlist, adding non-driver: ${nextPerson.fields["Participant Name"]}`);
        } else {
          return res.status(400).json({ error: "No participants on waitlist" });
        }
      } else if (driverSpotsAvailable > 0) {
        if (waitlistDrivers.length === 0) {
          return res.status(400).json({
            error: "No drivers available on waitlist",
            details: `${driverSpotsAvailable} driver spots available but no drivers on waitlist.`
          });
        }
        nextPerson = waitlistDrivers[0];
        console.log(`[Add from Waitlist] Driver spot available, adding driver: ${nextPerson.fields["Participant Name"]}`);
      } else if (nonDriverSpotsAvailable > 0) {
        if (waitlistNonDrivers.length === 0) {
          return res.status(400).json({
            error: "No non-drivers available on waitlist",
            details: `${nonDriverSpotsAvailable} non-driver spots available but no non-drivers on waitlist.`
          });
        }
        nextPerson = waitlistNonDrivers[0];
        console.log(`[Add from Waitlist] Non-driver spot available, adding non-driver: ${nextPerson.fields["Participant Name"]}`);
      }
      if (!nextPerson) {
        return res.status(400).json({ error: "No suitable participant found on waitlist" });
      }
      const isDriver = nextPerson.fields["Is Driver"];
      const newStatus = isDriver ? "Selected (driver)" : "Selected (nondriver)";
      console.log(`[Add from Waitlist] Adding ${nextPerson.fields["Participant Name"]} as ${newStatus}`);
      const updated = await updateSignup(nextPerson.id, {
        Status: newStatus
      });
      const response = {
        success: true,
        message: `Added ${nextPerson.fields["Participant Name"]} from waitlist to roster`,
        addedParticipant: updated
      };
      res.json(response);
    } catch (error) {
      console.error("Error adding from waitlist:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to add from waitlist"
      });
    }
  });
  app2.post("/api/airtable/addDriver", async (req, res) => {
    try {
      const validationResult = addDriverRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: validationResult.error });
      }
      const { tripId } = validationResult.data;
      const trip = await fetchTripById(tripId);
      console.log(`[Add Driver] Trip fields available:`, Object.keys(trip.fields));
      console.log(`[Add Driver] Capacity field value:`, trip.fields["Capacity (Including leads)"]);
      console.log(`[Add Driver] Additional Drivers Required field value:`, trip.fields["Additional Drivers Required"]);
      const maxParticipants = trip.fields["Capacity (Including leads)"] || 0;
      const driverSlots = trip.fields["Additional Drivers Required"] || 0;
      const signups = await fetchTripSignups(tripId);
      const roster = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        const isOnRoster = status.includes("selected") || status.includes("on trip");
        const isDropped = status.includes("dropped");
        return isOnRoster && !isDropped;
      });
      const currentDrivers = roster.filter((s) => s.fields["Is Driver"]).length;
      const currentTotal = roster.length;
      console.log(`[Add Driver] Total signups: ${signups.length}`);
      console.log(`[Add Driver] Roster size after filtering: ${currentTotal}/${maxParticipants}`);
      console.log(`[Add Driver] Current drivers: ${currentDrivers}/${driverSlots}`);
      if (currentTotal >= maxParticipants) {
        console.log(`[Add Driver] ERROR: Roster full - ${currentTotal}/${maxParticipants}`);
        return res.status(400).json({
          error: "Roster currently full!",
          details: `Roster is at capacity (${currentTotal}/${maxParticipants})`
        });
      }
      const driverSpotsAvailable = driverSlots - currentDrivers;
      if (driverSpotsAvailable <= 0) {
        return res.status(400).json({
          error: "No driver spots available",
          details: `All driver spots are filled (${currentDrivers}/${driverSlots})`
        });
      }
      const waitlist = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        return status.includes("waitlist");
      });
      const waitlistDrivers = waitlist.filter((s) => s.fields["Is Driver"]);
      if (waitlistDrivers.length === 0) {
        return res.status(400).json({ error: "No drivers on waitlist" });
      }
      const nextDriver = waitlistDrivers[0];
      console.log(`[Add Driver] Adding driver: ${nextDriver.fields["Participant Name"]}`);
      const updated = await updateSignup(nextDriver.id, {
        Status: "Selected (driver)"
      });
      const response = {
        success: true,
        message: `Added ${nextDriver.fields["Participant Name"]} (driver) from waitlist to roster`,
        addedParticipant: updated
      };
      res.json(response);
    } catch (error) {
      console.error("Error adding driver:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to add driver"
      });
    }
  });
  app2.post("/api/airtable/addNonDriver", async (req, res) => {
    try {
      const validationResult = addNonDriverRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: validationResult.error });
      }
      const { tripId } = validationResult.data;
      const trip = await fetchTripById(tripId);
      const maxParticipants = trip.fields["Capacity (Including leads)"] || 0;
      const driverSlots = trip.fields["Additional Drivers Required"] || 0;
      const signups = await fetchTripSignups(tripId);
      const roster = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        const isOnRoster = status.includes("selected") || status.includes("on trip");
        const isDropped = status.includes("dropped");
        return isOnRoster && !isDropped;
      });
      const currentNonDrivers = roster.filter((s) => !s.fields["Is Driver"]).length;
      const currentTotal = roster.length;
      console.log(`[Add Non-Driver] Total signups: ${signups.length}`);
      console.log(`[Add Non-Driver] Roster size after filtering: ${currentTotal}/${maxParticipants}`);
      console.log(`[Add Non-Driver] Current non-drivers: ${currentNonDrivers}`);
      if (currentTotal >= maxParticipants) {
        console.log(`[Add Non-Driver] ERROR: Roster full - ${currentTotal}/${maxParticipants}`);
        return res.status(400).json({
          error: "Roster currently full!",
          details: `Roster is at capacity (${currentTotal}/${maxParticipants})`
        });
      }
      const nonDriverCapacity = maxParticipants - driverSlots;
      const nonDriverSpotsAvailable = nonDriverCapacity - currentNonDrivers;
      if (nonDriverSpotsAvailable <= 0) {
        return res.status(400).json({
          error: "No non-driver spots available",
          details: `All non-driver spots are filled (${currentNonDrivers}/${nonDriverCapacity})`
        });
      }
      const waitlist = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        return status.includes("waitlist");
      });
      const waitlistNonDrivers = waitlist.filter((s) => !s.fields["Is Driver"]);
      if (waitlistNonDrivers.length === 0) {
        return res.status(400).json({ error: "No non-drivers on waitlist" });
      }
      const nextNonDriver = waitlistNonDrivers[0];
      console.log(`[Add Non-Driver] Adding non-driver: ${nextNonDriver.fields["Participant Name"]}`);
      const updated = await updateSignup(nextNonDriver.id, {
        Status: "Selected (nondriver)"
      });
      const response = {
        success: true,
        message: `Added ${nextNonDriver.fields["Participant Name"]} (non-driver) from waitlist to roster`,
        addedParticipant: updated
      };
      res.json(response);
    } catch (error) {
      console.error("Error adding non-driver:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to add non-driver"
      });
    }
  });
  app2.post("/api/airtable/reAddParticipant", async (req, res) => {
    try {
      const validationResult = reAddParticipantRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: validationResult.error });
      }
      const { tripId, participantId, participantName } = validationResult.data;
      const trip = await fetchTripById(tripId);
      const maxParticipants = trip.fields["Capacity (Including leads)"] || 0;
      const driverSlots = trip.fields["Additional Drivers Required"] || 0;
      const signups = await fetchTripSignups(tripId);
      const droppedParticipant = signups.find((s) => s.id === participantId);
      if (!droppedParticipant) {
        return res.status(404).json({ error: "Participant not found" });
      }
      const roster = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        const isOnRoster = status.includes("selected") || status.includes("on trip");
        const isDropped = status.includes("dropped");
        return isOnRoster && !isDropped;
      });
      const currentTotal = roster.length;
      console.log(`[Re-Add Participant] Total signups: ${signups.length}`);
      console.log(`[Re-Add Participant] Roster size after filtering: ${currentTotal}/${maxParticipants}`);
      console.log(`[Re-Add Participant] Attempting to re-add: ${participantName} (driver: ${droppedParticipant.fields["Is Driver"]})`);
      if (currentTotal >= maxParticipants) {
        console.log(`[Re-Add Participant] ERROR: Roster full - ${currentTotal}/${maxParticipants}`);
        return res.status(400).json({
          error: "Roster currently full!",
          details: `Cannot re-add participant. Roster is at capacity (${currentTotal}/${maxParticipants})`
        });
      }
      const isDriver = droppedParticipant.fields["Is Driver"];
      const currentDrivers = roster.filter((s) => s.fields["Is Driver"]).length;
      const currentNonDrivers = roster.length - currentDrivers;
      if (isDriver) {
        const driverSpotsAvailable = driverSlots - currentDrivers;
        if (driverSpotsAvailable <= 0) {
          return res.status(400).json({
            error: "No driver spots available",
            details: `All driver spots are filled (${currentDrivers}/${driverSlots})`
          });
        }
      } else {
        const nonDriverCapacity = maxParticipants - driverSlots;
        const nonDriverSpotsAvailable = nonDriverCapacity - currentNonDrivers;
        if (nonDriverSpotsAvailable <= 0) {
          return res.status(400).json({
            error: "No non-driver spots available",
            details: `All non-driver spots are filled (${currentNonDrivers}/${nonDriverCapacity})`
          });
        }
      }
      const newStatus = isDriver ? "Selected (driver)" : "Selected (nondriver)";
      console.log(`[Re-Add Participant] Re-adding ${participantName} as ${newStatus}`);
      const updated = await updateSignup(participantId, {
        Status: newStatus
      });
      const response = {
        success: true,
        message: `Re-added ${participantName} to roster`,
        addedParticipant: updated
      };
      res.json(response);
    } catch (error) {
      console.error("Error re-adding participant:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to re-add participant"
      });
    }
  });
  app2.post("/api/airtable/dropParticipant", async (req, res) => {
    try {
      const validationResult = dropParticipantRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: validationResult.error });
      }
      const { tripId, participantId, participantName } = validationResult.data;
      const todayDate = format(/* @__PURE__ */ new Date(), "MM/dd/yyyy");
      const newStatus = `Dropped- ${todayDate}`;
      console.log(`[Drop Participant] Updating participant ${participantId} (${participantName}) to status: ${newStatus}`);
      const updated = await updateSignup(participantId, {
        Status: newStatus
      });
      console.log(`[Drop Participant] Successfully updated. New status: ${updated.fields.Status}`);
      const response = {
        success: true,
        message: `Removed ${participantName || "participant"} from roster`
      };
      res.json(response);
    } catch (error) {
      console.error("Error dropping participant:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to drop participant"
      });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs from "fs";
import path2 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var vite_config_default = defineConfig({
  plugins: [
    react(),
    // Only use Replit plugins in Replit environment
    ...process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-runtime-error-modal").then(
        (m) => m.default()
      ),
      ...process.env.NODE_ENV !== "production" ? [
        await import("@replit/vite-plugin-cartographer").then(
          (m) => m.cartographer()
        ),
        await import("@replit/vite-plugin-dev-banner").then(
          (m) => m.devBanner()
        )
      ] : []
    ] : []
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets")
    }
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"]
    },
    host: true,
    // Important for Render
    port: 5e3
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
import { fileURLToPath as fileURLToPath2 } from "url";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const __dirname2 = path2.dirname(fileURLToPath2(import.meta.url));
      const clientTemplate = path2.resolve(
        __dirname2,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(process.cwd(), "dist", "public");
  if (!fs.existsSync(distPath)) {
    log(`ERROR: Build directory not found at: ${distPath}`, "static");
    log(`Current working directory: ${process.cwd()}`, "static");
    log(`Checking if dist exists: ${fs.existsSync(path2.resolve(process.cwd(), "dist"))}`, "static");
    throw new Error(
      `Could not find the build directory: ${distPath}. Make sure to build the client first with 'npm run build'`
    );
  }
  log(`Serving static files from: ${distPath}`, "static");
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.use(express2.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path3 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path3.startsWith("/api")) {
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
})();
