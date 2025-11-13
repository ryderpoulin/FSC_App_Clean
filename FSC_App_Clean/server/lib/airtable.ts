import type { Trip, Signup } from "@shared/schema";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const TRIPS_TABLE = process.env.AIRTABLE_TRIPS_TABLE!;
const SIGNUPS_TABLE = process.env.AIRTABLE_SIGNUPS_TABLE!;

const AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

const headers = {
  Authorization: `Bearer ${AIRTABLE_API_KEY}`,
  "Content-Type": "application/json",
};

// Raw Airtable Signup structure (as it comes from the API)
interface AirtableSignupFields {
  "Slack Name Refined"?: string;
  "Trip LeadName"?: string[];
  "Do you have a car? (from Slack Name)"?: (boolean | null)[];
  Status?: string;
  "Personal Email"?: string;
  "Emergency Contact Phone Number (from Participant Info)"?: string[];
  [key: string]: any; // Allow other fields
}

interface AirtableSignup {
  id: string;
  fields: AirtableSignupFields;
  createdTime?: string;
}

/**
 * Transforms raw Airtable signup data to the normalized schema expected by the app
 * 
 * Note: We preserve detailed status strings as-is from Airtable:
 * - "Selected (driver)" / "Selected (nondriver)"
 * - "Waitlist (driver) - 1" / "Waitlist (nondriver) - 2"
 * - "Dropped- MM/DD/YYYY"
 * 
 * Legacy statuses are still preserved for backward compatibility:
 * - "ON TRIP" (legacy roster format)
 * - "WAITLIST" (legacy waitlist format)
 */
function normalizeSignup(rawSignup: AirtableSignup): Signup {
  const fields = rawSignup.fields;
  
  // Use the raw status string as-is from Airtable
  // This preserves all detailed information like driver designation and waitlist numbers
  const normalizedStatus = fields.Status || "UNKNOWN";
  
  // Determine if driver based on car availability
  const hasCar = fields["Do you have a car? (from Slack Name)"]?.some(Boolean) || false;
  
  // Extract phone number (first non-empty entry)
  const phoneArray = fields["Emergency Contact Phone Number (from Participant Info)"] || [];
  const phone = phoneArray.find((p) => p && p.trim()) || undefined;
  
  return {
    id: rawSignup.id,
    fields: {
      "Participant Name": fields["Slack Name Refined"] || "Unknown",
      "Trip ID": fields["Trip LeadName"] || [],
      "Is Driver": hasCar,
      Status: normalizedStatus,
      Email: fields["Personal Email"],
      Phone: phone,
    },
  };
}

export async function fetchTrips(): Promise<Trip[]> {
  const response = await fetch(`${AIRTABLE_BASE_URL}/${encodeURIComponent(TRIPS_TABLE)}`, {
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch trips: ${error}`);
  }

  const data = await response.json();
  return data.records as Trip[];
}

export async function fetchTripById(tripId: string): Promise<Trip> {
  const response = await fetch(
    `${AIRTABLE_BASE_URL}/${encodeURIComponent(TRIPS_TABLE)}/${tripId}`,
    { headers }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch trip: ${error}`);
  }

  return (await response.json()) as Trip;
}

export async function fetchTripSignups(tripId: string): Promise<Signup[]> {
  // Fetch ALL signups with pagination (Airtable limits to 100 records per request)
  let allRawSignups: AirtableSignup[] = [];
  let offset: string | undefined = undefined;
  
  do {
    const url: string = offset
      ? `${AIRTABLE_BASE_URL}/${encodeURIComponent(SIGNUPS_TABLE)}?offset=${offset}`
      : `${AIRTABLE_BASE_URL}/${encodeURIComponent(SIGNUPS_TABLE)}`;
    
    const response: Response = await fetch(url, { headers });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch signups: ${error}`);
    }

    const data: any = await response.json();
    allRawSignups = allRawSignups.concat(data.records as AirtableSignup[]);
    offset = data.offset; // Will be undefined when no more pages
  } while (offset);
  
  // Filter signups that match the tripId using the "Trip LeadName" field
  // Note: Despite its confusing name, "Trip LeadName" in Airtable contains trip record IDs, not names
  const filtered = allRawSignups.filter((signup) => {
    const signupTripIds = signup.fields["Trip LeadName"];
    if (Array.isArray(signupTripIds)) {
      return signupTripIds.includes(tripId);
    }
    return false;
  });
  
  // Transform raw Airtable data to normalized schema
  return filtered.map(normalizeSignup);
}

export async function updateSignup(
  signupId: string,
  updates: Partial<Signup["fields"]>
): Promise<Signup> {
  // Map normalized field names back to Airtable field names
  const airtableUpdates: Partial<AirtableSignupFields> = {};
  
  if (updates.Status !== undefined) {
    // Map app status back to Airtable status
    if (updates.Status === "Roster") {
      // Legacy generic roster status
      airtableUpdates.Status = "ON TRIP";
    } else if (updates.Status === "Waitlist") {
      // Legacy generic waitlist status
      airtableUpdates.Status = "WAITLIST";
    } else {
      // For detailed statuses like:
      // - "Selected (driver)" / "Selected (nondriver)"
      // - "Waitlist (driver) - 1" / "Waitlist (nondriver) - 2"
      // - "Dropped- [date]"
      // Use the status string as-is
      console.log(`[updateSignup] Setting Airtable status to: ${updates.Status}`);
      airtableUpdates.Status = updates.Status;
    }
  }
  
  // Note: "Is Driver" field is computed from "Do you have a car? (from Slack Name)"
  // which is a lookup field from linked records. We cannot write to it.
  // The driver eligibility is already determined at signup time and stored in the source table.
  
  const response = await fetch(
    `${AIRTABLE_BASE_URL}/${encodeURIComponent(SIGNUPS_TABLE)}/${signupId}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ fields: airtableUpdates }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update signup: ${error}`);
  }

  const rawUpdated = (await response.json()) as AirtableSignup;
  return normalizeSignup(rawUpdated);
}

export async function deleteSignup(signupId: string): Promise<void> {
  const response = await fetch(
    `${AIRTABLE_BASE_URL}/${encodeURIComponent(SIGNUPS_TABLE)}/${signupId}`,
    {
      method: "DELETE",
      headers,
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to delete signup: ${error}`);
  }
}
