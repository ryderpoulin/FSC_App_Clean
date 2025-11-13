import type { Express } from "express";
import { createServer, type Server } from "http";
import pLimit from "p-limit";
import { format } from "date-fns";
import {
  fetchTrips,
  fetchTripById,
  fetchTripSignups,
  updateSignup,
} from "./lib/airtable";
import {
  type TripsResponse,
  type SignupsResponse,
  type RandomizeResponse,
  type ApproveRandomizationResponse,
  type AddFromWaitlistResponse,
  type DropParticipantResponse,
  type Signup,
  randomizeRequestSchema,
  approveRandomizationRequestSchema,
  addFromWaitlistRequestSchema,
  addDriverRequestSchema,
  addNonDriverRequestSchema,
  reAddParticipantRequestSchema,
  dropParticipantRequestSchema,
} from "@shared/schema";

// In-memory cache for proposed randomizations with 10-minute TTL
interface ProposedRoster {
  rosterIds: string[];
  waitlistIds: string[];
  timestamp: number;
}

const proposedRosters = new Map<string, ProposedRoster>();
const PROPOSAL_TTL = 10 * 60 * 1000; // 10 minutes

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

// Run cleanup every minute
setInterval(cleanupExpiredProposals, 60 * 1000);

export async function registerRoutes(app: Express): Promise<Server> {
  // GET all trips
  app.get("/api/airtable/trips", async (req, res) => {
    try {
      const trips = await fetchTrips();
      const response: TripsResponse = { trips };
      res.json(response);
    } catch (error) {
      console.error("Error fetching trips:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch trips",
      });
    }
  });

  // GET single trip by ID
  app.get("/api/airtable/trips/:id", async (req, res) => {
    try {
      const trip = await fetchTripById(req.params.id);
      res.json({ trip });
    } catch (error) {
      console.error("Error fetching trip:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch trip",
      });
    }
  });

  // GET signups for a trip
  app.get("/api/airtable/signups/:tripId", async (req, res) => {
    try {
      const signups = await fetchTripSignups(req.params.tripId);

      // Filter roster: status contains "selected" or "on trip" (case-insensitive)
      // Explicitly exclude dropped participants
      // This handles both new formats ("Selected (driver)", "Selected (nondriver)") and legacy ("ON TRIP")
      const roster = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        const isOnRoster = status.includes("selected") || status.includes("on trip");
        const isDropped = status.includes("dropped");
        return isOnRoster && !isDropped;
      });
      
      // Filter waitlist: status contains "waitlist" (case-insensitive)
      // This handles both new formats ("Waitlist (driver) - 1", "Waitlist (nondriver) - 2") and legacy ("WAITLIST")
      const waitlist = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        return status.includes("waitlist");
      });

      // Filter dropped: status contains "dropped" (case-insensitive)
      const dropped = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        return status.includes("dropped");
      });
      
      const driverCount = roster.filter((s) => s.fields["Is Driver"]).length;

      const response: SignupsResponse = {
        signups,
        roster,
        waitlist,
        dropped,
        driverCount,
      };

      res.json(response);
    } catch (error) {
      console.error("Error fetching signups:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch signups",
      });
    }
  });

  // POST randomize roster
  app.post("/api/airtable/randomize", async (req, res) => {
    try {
      const validationResult = randomizeRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: validationResult.error });
      }
      const { tripId } = validationResult.data;

      // Fetch trip details to get capacity requirements
      const trip = await fetchTripById(tripId);
      const driverSlotsNeeded = trip.fields["Additional Drivers Required"] || 0;
      const nonDriverSlotsNeeded = trip.fields["Non-Drivers Capacity"] || 0;

      if (driverSlotsNeeded === 0 && nonDriverSlotsNeeded === 0) {
        return res.status(400).json({ error: "Trip has no capacity defined for drivers or non-drivers" });
      }

      // Get ALL signups (both roster and waitlist)
      const allSignups = await fetchTripSignups(tripId);

      if (allSignups.length === 0) {
        return res.status(400).json({ error: "No participants signed up for this trip" });
      }

      // Separate into driver-eligible and non-driver pools
      const driverEligible = allSignups.filter((s) => s.fields["Is Driver"] === true);
      const nonDriverEligible = allSignups.filter((s) => s.fields["Is Driver"] !== true);

      // Randomly shuffle each pool
      const shuffledDrivers = [...driverEligible].sort(() => Math.random() - 0.5);
      const shuffledNonDrivers = [...nonDriverEligible].sort(() => Math.random() - 0.5);

      // Select drivers for driver slots
      const selectedAsDrivers = shuffledDrivers.slice(0, driverSlotsNeeded);
      const remainingDriverPool = shuffledDrivers.slice(driverSlotsNeeded);

      // Select non-drivers for non-driver slots
      let selectedAsNonDrivers = shuffledNonDrivers.slice(0, nonDriverSlotsNeeded);
      let remainingNonDriverPool = shuffledNonDrivers.slice(nonDriverSlotsNeeded);

      // Backfill logic: if non-driver slots aren't filled, use remaining drivers
      const nonDriverSlotsFilled = selectedAsNonDrivers.length;
      let driversUsedAsNonDrivers: Signup[] = [];
      let finalRemainingDriverPool = remainingDriverPool;
      
      if (nonDriverSlotsFilled < nonDriverSlotsNeeded && remainingDriverPool.length > 0) {
        const neededBackfill = nonDriverSlotsNeeded - nonDriverSlotsFilled;
        driversUsedAsNonDrivers = remainingDriverPool.slice(0, neededBackfill);
        selectedAsNonDrivers = [...selectedAsNonDrivers, ...driversUsedAsNonDrivers];
        // Update remaining driver pool (remove those used for backfill)
        finalRemainingDriverPool = remainingDriverPool.slice(neededBackfill);
      }

      // Everyone not selected goes to waitlist
      const rejectedDrivers = finalRemainingDriverPool;
      const rejectedNonDrivers = remainingNonDriverPool;

      // Build proposed roster and waitlist (without updating Airtable yet)
      const proposedRoster = [...selectedAsDrivers, ...selectedAsNonDrivers];
      const proposedWaitlist = [...rejectedDrivers, ...rejectedNonDrivers];

      // Store the proposal server-side for validation during approval
      const rosterIds = proposedRoster.map(s => s.id);
      const waitlistIds = proposedWaitlist.map(s => s.id);
      proposedRosters.set(tripId, {
        rosterIds,
        waitlistIds,
        timestamp: Date.now(),
      });

      console.log(`[Randomize] Proposed roster: ${proposedRoster.length} participants (${selectedAsDrivers.length} drivers, ${selectedAsNonDrivers.length} non-drivers)`);
      console.log(`[Randomize] Proposed waitlist: ${proposedWaitlist.length} participants`);
      console.log(`[Randomize] Proposal stored for trip ${tripId}`);

      const response: RandomizeResponse = {
        success: true,
        message: `Randomized ${proposedRoster.length} participants to roster (${selectedAsDrivers.length} drivers, ${selectedAsNonDrivers.length} non-drivers). Click Approve to commit changes.`,
        proposedRoster,
        proposedWaitlist,
      };

      res.json(response);
    } catch (error) {
      console.error("Error randomizing roster:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to randomize roster",
      });
    }
  });

  // POST approve randomization
  app.post("/api/airtable/approve-randomization", async (req, res) => {
    try {
      const validationResult = approveRandomizationRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: validationResult.error });
      }
      const { tripId, rosterIds, waitlistIds } = validationResult.data;

      // SECURITY: Validate that the approval matches the server-side stored proposal
      const storedProposal = proposedRosters.get(tripId);
      if (!storedProposal) {
        return res.status(400).json({ 
          error: "No pending randomization found",
          details: "Please randomize the roster first, or your proposal has expired (10 minute limit)"
        });
      }

      // Validate that the provided IDs match the stored proposal exactly
      const rosterIdsSet = new Set(rosterIds);
      const waitlistIdsSet = new Set(waitlistIds);
      const storedRosterSet = new Set(storedProposal.rosterIds);
      const storedWaitlistSet = new Set(storedProposal.waitlistIds);

      // Check if roster IDs match
      const rosterMatches = 
        rosterIds.length === storedProposal.rosterIds.length &&
        rosterIds.every(id => storedRosterSet.has(id));

      const waitlistMatches =
        waitlistIds.length === storedProposal.waitlistIds.length &&
        waitlistIds.every(id => storedWaitlistSet.has(id));

      if (!rosterMatches || !waitlistMatches) {
        return res.status(400).json({ 
          error: "Approval data does not match randomization",
          details: "The roster/waitlist assignment does not match what was randomized. Please randomize again."
        });
      }

      console.log(`[Approve] Proposal validation passed. Updating ${rosterIds.length} to roster, ${waitlistIds.length} to waitlist`);

      // Clear the stored proposal BEFORE updates to prevent retries/double-approvals
      proposedRosters.delete(tripId);
      console.log(`[Approve] Proposal cleared, proceeding with Airtable updates`);

      // Fetch signup data to determine driver status for each participant
      const signups = await fetchTripSignups(tripId);
      const signupMap = new Map(signups.map(s => [s.id, s]));

      // Separate roster by driver/non-driver and set appropriate status
      const rosterUpdates: Array<{ id: string; status: string }> = [];
      rosterIds.forEach((id) => {
        const signup = signupMap.get(id);
        if (signup) {
          const isDriver = signup.fields["Is Driver"];
          const status = isDriver ? "Selected (driver)" : "Selected (nondriver)";
          rosterUpdates.push({ id, status });
        }
      });

      // Separate waitlist by driver/non-driver and number them
      const waitlistDrivers: string[] = [];
      const waitlistNonDrivers: string[] = [];
      
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

      const waitlistUpdates: Array<{ id: string; status: string }> = [];
      
      // Number driver waitlist
      waitlistDrivers.forEach((id, index) => {
        const status = `Waitlist (driver) - ${index + 1}`;
        waitlistUpdates.push({ id, status });
      });

      // Number non-driver waitlist
      waitlistNonDrivers.forEach((id, index) => {
        const status = `Waitlist (nondriver) - ${index + 1}`;
        waitlistUpdates.push({ id, status });
      });

      // Update all signups with rate limiting (max 2 concurrent requests to stay under Airtable's 5 req/s limit)
      const limit = pLimit(2);
      const updateTasks: Array<() => Promise<Signup>> = [];

      // Add roster updates
      rosterUpdates.forEach(({ id, status }) => {
        updateTasks.push(() => updateSignup(id, { Status: status }));
      });

      // Add waitlist updates
      waitlistUpdates.forEach(({ id, status }) => {
        updateTasks.push(() => updateSignup(id, { Status: status }));
      });

      // Execute all updates with concurrency limit
      await Promise.all(updateTasks.map((task) => limit(task)));

      console.log(`[Approve] Successfully updated ${updateTasks.length} signups (${rosterUpdates.length} roster, ${waitlistUpdates.length} waitlist)`);

      const response: ApproveRandomizationResponse = {
        success: true,
        message: `Successfully updated roster: ${rosterIds.length} on roster, ${waitlistIds.length} on waitlist`,
      };

      res.json(response);
    } catch (error) {
      console.error("Error approving randomization:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to approve randomization",
      });
    }
  });

  // POST add from waitlist
  app.post("/api/airtable/addFromWaitlist", async (req, res) => {
    try {
      const validationResult = addFromWaitlistRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: validationResult.error });
      }
      const { tripId } = validationResult.data;

      // Fetch trip details to check capacity constraints
      const trip = await fetchTripById(tripId);
      const maxParticipants = trip.fields["Capacity (Including leads)"] || 0;
      const driverSlots = trip.fields["Additional Drivers Required"] || 0;

      const signups = await fetchTripSignups(tripId);
      
      // Filter roster: status contains "selected" or "on trip" (case-insensitive)
      // Explicitly exclude dropped participants
      const roster = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        // Only count participants on roster (not dropped, not waitlist)
        const isOnRoster = status.includes("selected") || status.includes("on trip");
        const isDropped = status.includes("dropped");
        return isOnRoster && !isDropped;
      });

      // Count current drivers and non-drivers on roster
      const currentDrivers = roster.filter((s) => s.fields["Is Driver"]).length;
      const currentNonDrivers = roster.length - currentDrivers;
      const currentTotal = roster.length;

      console.log(`[Add from Waitlist] Current roster composition: ${currentTotal}/${maxParticipants} total (${currentDrivers} drivers, ${currentNonDrivers} non-drivers)`);
      console.log(`[Add from Waitlist] Capacity: ${driverSlots} driver slots, ${maxParticipants - driverSlots} non-driver capacity`);

      // Check if roster is at capacity
      if (currentTotal >= maxParticipants) {
        return res.status(400).json({ 
          error: "Roster currently full!",
          details: `Roster is at capacity (${currentTotal}/${maxParticipants})`
        });
      }

      // Calculate available spots
      const driverSpotsAvailable = driverSlots - currentDrivers;
      const nonDriverSpotsAvailable = maxParticipants - driverSlots - currentNonDrivers;

      console.log(`[Add from Waitlist] Roster: ${currentTotal}/${maxParticipants}, Drivers: ${currentDrivers}/${driverSlots}, Driver spots available: ${driverSpotsAvailable}, Non-driver spots available: ${nonDriverSpotsAvailable}`);

      // Filter waitlist: status contains "waitlist" (case-insensitive)
      const waitlist = signups.filter((s) => {
        const status = s.fields.Status?.toLowerCase() || "";
        return status.includes("waitlist");
      });

      if (waitlist.length === 0) {
        return res.status(400).json({ error: "No participants on waitlist" });
      }

      // Separate waitlist by driver status to see what's actually available
      const waitlistDrivers = waitlist.filter((s) => s.fields["Is Driver"]);
      const waitlistNonDrivers = waitlist.filter((s) => !s.fields["Is Driver"]);

      // Determine what participant to add based on available spots AND waitlist availability
      let nextPerson: Signup | undefined;
      
      if (driverSpotsAvailable > 0 && nonDriverSpotsAvailable > 0) {
        // Both types of spots available - add whoever is available on waitlist
        // Prioritize drivers if both are available on waitlist
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
        // Only driver spots available
        if (waitlistDrivers.length === 0) {
          return res.status(400).json({ 
            error: "No drivers available on waitlist",
            details: `${driverSpotsAvailable} driver spots available but no drivers on waitlist.`
          });
        }
        nextPerson = waitlistDrivers[0];
        console.log(`[Add from Waitlist] Driver spot available, adding driver: ${nextPerson.fields["Participant Name"]}`);
      } else if (nonDriverSpotsAvailable > 0) {
        // Only non-driver spots available
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

      // Determine status based on whether they're a driver
      const isDriver = nextPerson.fields["Is Driver"];
      const newStatus = isDriver ? "Selected (driver)" : "Selected (nondriver)";

      console.log(`[Add from Waitlist] Adding ${nextPerson.fields["Participant Name"]} as ${newStatus}`);

      // Move them to roster with new status format
      const updated = await updateSignup(nextPerson.id, {
        Status: newStatus,
      });

      const response: AddFromWaitlistResponse = {
        success: true,
        message: `Added ${nextPerson.fields["Participant Name"]} from waitlist to roster`,
        addedParticipant: updated,
      };

      res.json(response);
    } catch (error) {
      console.error("Error adding from waitlist:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to add from waitlist",
      });
    }
  });

  // POST add driver from waitlist
  app.post("/api/airtable/addDriver", async (req, res) => {
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

      // Check capacity
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

      // Find first driver on waitlist
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
        Status: "Selected (driver)",
      });

      const response: AddFromWaitlistResponse = {
        success: true,
        message: `Added ${nextDriver.fields["Participant Name"]} (driver) from waitlist to roster`,
        addedParticipant: updated,
      };

      res.json(response);
    } catch (error) {
      console.error("Error adding driver:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to add driver",
      });
    }
  });

  // POST add non-driver from waitlist
  app.post("/api/airtable/addNonDriver", async (req, res) => {
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

      // Check capacity
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

      // Find first non-driver on waitlist
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
        Status: "Selected (nondriver)",
      });

      const response: AddFromWaitlistResponse = {
        success: true,
        message: `Added ${nextNonDriver.fields["Participant Name"]} (non-driver) from waitlist to roster`,
        addedParticipant: updated,
      };

      res.json(response);
    } catch (error) {
      console.error("Error adding non-driver:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to add non-driver",
      });
    }
  });

  // POST re-add dropped participant
  app.post("/api/airtable/reAddParticipant", async (req, res) => {
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
      
      // Find the dropped participant
      const droppedParticipant = signups.find(s => s.id === participantId);
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

      // Check capacity
      if (currentTotal >= maxParticipants) {
        console.log(`[Re-Add Participant] ERROR: Roster full - ${currentTotal}/${maxParticipants}`);
        return res.status(400).json({ 
          error: "Roster currently full!",
          details: `Cannot re-add participant. Roster is at capacity (${currentTotal}/${maxParticipants})`
        });
      }

      // Check if there's space for this type of participant
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

      // Re-add to roster
      const newStatus = isDriver ? "Selected (driver)" : "Selected (nondriver)";
      console.log(`[Re-Add Participant] Re-adding ${participantName} as ${newStatus}`);

      const updated = await updateSignup(participantId, {
        Status: newStatus,
      });

      const response: AddFromWaitlistResponse = {
        success: true,
        message: `Re-added ${participantName} to roster`,
        addedParticipant: updated,
      };

      res.json(response);
    } catch (error) {
      console.error("Error re-adding participant:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to re-add participant",
      });
    }
  });

  // POST drop participant
  app.post("/api/airtable/dropParticipant", async (req, res) => {
    try {
      const validationResult = dropParticipantRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: "Invalid request body", details: validationResult.error });
      }
      const { tripId, participantId, participantName } = validationResult.data;

      // Update status to "Dropped- [date]" instead of deleting
      const todayDate = format(new Date(), "MM/dd/yyyy");
      const newStatus = `Dropped- ${todayDate}`;
      console.log(`[Drop Participant] Updating participant ${participantId} (${participantName}) to status: ${newStatus}`);
      
      const updated = await updateSignup(participantId, {
        Status: newStatus,
      });
      
      console.log(`[Drop Participant] Successfully updated. New status: ${updated.fields.Status}`);

      const response: DropParticipantResponse = {
        success: true,
        message: `Removed ${participantName || "participant"} from roster`,
      };

      res.json(response);
    } catch (error) {
      console.error("Error dropping participant:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to drop participant",
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
