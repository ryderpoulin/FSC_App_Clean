import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Shuffle, UserPlus, UserMinus, Users, Car, Clock, UserCircle2, Calendar, DollarSign, MapPin, Info, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SignupsResponse, Trip, Signup, RandomizeResponse, ApproveRandomizationResponse, AddFromWaitlistResponse, DropParticipantResponse } from "@shared/schema";
import { format, parseISO } from "date-fns";

export default function TripDetail() {
  const [, params] = useRoute("/trip/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const tripId = params?.id;

  const [participantToDelete, setParticipantToDelete] = useState<Signup | null>(null);
  const [proposedRoster, setProposedRoster] = useState<Signup[] | null>(null);
  const [proposedWaitlist, setProposedWaitlist] = useState<Signup[] | null>(null);

  // Fetch trip details
  const { data: tripData, isLoading: isTripLoading } = useQuery<{ trip: Trip }>({
    queryKey: [`/api/airtable/trips/${tripId}`],
    enabled: !!tripId,
  });

  // Fetch signups
  const {
    data: signupsData,
    isLoading: isSignupsLoading,
    error,
  } = useQuery<SignupsResponse>({
    queryKey: [`/api/airtable/signups/${tripId}`],
    enabled: !!tripId,
  });

  // Randomize mutation (generates proposed roster without committing)
  const randomizeMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest<RandomizeResponse>("POST", "/api/airtable/randomize", { tripId });
    },
    onSuccess: (data) => {
      setProposedRoster(data.proposedRoster);
      setProposedWaitlist(data.proposedWaitlist);
      toast({
        title: "Roster Randomized!",
        description: data.message,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Randomization Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Approve randomization mutation (commits changes to Airtable)
  const approveRandomizationMutation = useMutation({
    mutationFn: async () => {
      if (!proposedRoster || !proposedWaitlist) {
        throw new Error("No proposed roster to approve");
      }
      const rosterIds = proposedRoster.map(s => s.id);
      const waitlistIds = proposedWaitlist.map(s => s.id);
      console.log('[Approve] Committing changes:', { rosterCount: rosterIds.length, waitlistCount: waitlistIds.length });
      const result = await apiRequest<ApproveRandomizationResponse>("POST", "/api/airtable/approve-randomization", {
        tripId,
        rosterIds,
        waitlistIds,
      });
      
      // Refetch signups immediately after approval to ensure fresh data
      await queryClient.refetchQueries({ queryKey: [`/api/airtable/signups/${tripId}`] });
      console.log('[Approve] Signups refetched after approval');
      
      return result;
    },
    onSuccess: (data) => {
      console.log('[Approve] Success, clearing proposed state');
      setProposedRoster(null);
      setProposedWaitlist(null);
      
      toast({
        title: "Roster Approved!",
        description: data.message,
      });
    },
    onError: (error: Error) => {
      console.error('[Approve] Error:', error);
      toast({
        title: "Approval Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Add driver from waitlist mutation
  const addDriverMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest<AddFromWaitlistResponse>("POST", "/api/airtable/addDriver", { tripId });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/airtable/signups/${tripId}`] });
      toast({
        title: "Driver Added!",
        description: data.message || "Successfully added driver from waitlist",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Add Driver",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Add non-driver from waitlist mutation
  const addNonDriverMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest<AddFromWaitlistResponse>("POST", "/api/airtable/addNonDriver", { tripId });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/airtable/signups/${tripId}`] });
      toast({
        title: "Participant Added!",
        description: data.message || "Successfully added non-driver from waitlist",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Add Participant",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Re-add dropped participant mutation
  const reAddParticipantMutation = useMutation({
    mutationFn: async (participant: Signup) => {
      return await apiRequest<AddFromWaitlistResponse>("POST", "/api/airtable/reAddParticipant", {
        tripId,
        participantId: participant.id,
        participantName: participant.fields["Participant Name"],
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/airtable/signups/${tripId}`] });
      toast({
        title: "Participant Re-Added!",
        description: data.message || "Successfully re-added participant to roster",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Re-Add Participant",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Drop participant mutation
  const dropParticipantMutation = useMutation({
    mutationFn: async (participant: Signup) => {
      return await apiRequest<DropParticipantResponse>("POST", "/api/airtable/dropParticipant", {
        tripId,
        participantId: participant.id,
        participantName: participant.fields["Participant Name"],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/airtable/signups/${tripId}`] });
      toast({
        title: "Participant Removed",
        description: "Successfully removed from roster",
      });
      setParticipantToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Remove Participant",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const formatDateRange = (startDate: string, endDate: string) => {
    try {
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      return `${format(start, "MMMM d")} - ${format(end, "MMMM d, yyyy")}`;
    } catch {
      return `${startDate} - ${endDate}`;
    }
  };

  const isLoading = isTripLoading || isSignupsLoading;
  const trip = tripData?.trip;
  const roster = signupsData?.roster || [];
  const waitlist = signupsData?.waitlist || [];
  const dropped = signupsData?.dropped || [];
  const driverCount = signupsData?.driverCount || 0;

  // Separate waitlist into drivers and non-drivers
  const waitlistDrivers = waitlist.filter(p => p.fields["Is Driver"]);
  const waitlistNonDrivers = waitlist.filter(p => !p.fields["Is Driver"]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Button
            variant="ghost"
            onClick={() => setLocation("/dashboard")}
            data-testid="button-back"
            className="gap-2 -ml-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Trip Header */}
        {isLoading ? (
          <div className="mb-8 space-y-2">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-6 w-1/3" />
          </div>
        ) : trip ? (
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2" data-testid="text-trip-name">
              {trip.fields["Trip Name"]}
            </h1>
            <p className="text-lg text-muted-foreground flex items-center gap-2">
              <Clock className="w-5 h-5" />
              {formatDateRange(trip.fields["Start Date"], trip.fields["End Date"])}
            </p>
          </div>
        ) : null}

        {/* Error State */}
        {error && (
          <Card className="border-destructive/50 bg-destructive/5 mb-6">
            <CardHeader>
              <CardTitle className="text-destructive">Error Loading Trip Details</CardTitle>
              <CardDescription>
                {error instanceof Error ? error.message : "Failed to fetch trip information"}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* Content Grid */}
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - Roster & Waitlist */}
          <div className="lg:col-span-2 space-y-8">
            {/* Trip Lead Section */}
            {trip?.fields["Trip Lead Name"] && (
              <Card className="border-border bg-primary/5">
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl font-semibold flex items-center gap-2">
                    <UserCircle2 className="w-5 h-5 text-primary" />
                    Trip Lead{trip.fields["Trip Lead Name"].includes(" / ") ? "s" : ""}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {trip.fields["Trip Lead Name"].split(" / ").map((lead, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 py-3 px-4 rounded-lg border border-primary/20 bg-background"
                        data-testid={`text-trip-lead-${index}`}
                      >
                        <UserCircle2 className="w-5 h-5 text-primary" />
                        <span className="font-medium text-lg">{lead.trim()}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Roster Section */}
            <Card className="border-border">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl font-semibold flex items-center gap-2">
                    <Users className="w-5 h-5 text-primary" />
                    Roster
                  </CardTitle>
                  <Badge variant="secondary" className="text-base px-3 py-1">
                    {roster.length} {roster.length === 1 ? "participant" : "participants"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : roster.length > 0 ? (
                  <div className="space-y-2">
                    {roster.map((participant) => (
                      <div
                        key={participant.id}
                        className="flex items-center justify-between py-3 px-4 rounded-lg border border-border hover-elevate"
                        data-testid={`participant-${participant.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium">
                            {participant.fields["Participant Name"]}
                          </span>
                          {participant.fields["Is Driver"] && (
                            <Badge variant="outline" className="gap-1 bg-primary/5 text-primary border-primary/20">
                              <Car className="w-3 h-3" />
                              Driver
                            </Badge>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setParticipantToDelete(participant)}
                          data-testid={`button-drop-${participant.id}`}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <UserMinus className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No participants on roster yet</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Waitlist Section */}
            <Card className="border-border">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl font-semibold">Waitlist</CardTitle>
                  <Badge variant="secondary" className="text-base px-3 py-1">
                    {waitlist.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {isLoading ? (
                  <div className="space-y-3">
                    {[1, 2].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : waitlist.length > 0 ? (
                  <>
                    {/* Drivers Waitlist */}
                    {waitlistDrivers.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Car className="w-4 h-4 text-primary" />
                          <h3 className="font-semibold text-sm text-muted-foreground">Drivers ({waitlistDrivers.length})</h3>
                        </div>
                        <div className="space-y-2">
                          {waitlistDrivers.map((participant, index) => (
                            <div
                              key={participant.id}
                              className="flex items-center justify-between py-3 px-4 rounded-lg border border-border"
                              data-testid={`waitlist-driver-${participant.id}`}
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-muted-foreground w-6">
                                  #{index + 1}
                                </span>
                                <span className="font-medium">
                                  {participant.fields["Participant Name"]}
                                </span>
                                <Badge variant="outline" className="gap-1 bg-primary/5 text-primary border-primary/20">
                                  <Car className="w-3 h-3" />
                                  Driver
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Non-Drivers Waitlist */}
                    {waitlistNonDrivers.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Users className="w-4 h-4 text-muted-foreground" />
                          <h3 className="font-semibold text-sm text-muted-foreground">Non-Drivers ({waitlistNonDrivers.length})</h3>
                        </div>
                        <div className="space-y-2">
                          {waitlistNonDrivers.map((participant, index) => (
                            <div
                              key={participant.id}
                              className="flex items-center justify-between py-3 px-4 rounded-lg border border-border"
                              data-testid={`waitlist-nondriver-${participant.id}`}
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-muted-foreground w-6">
                                  #{index + 1}
                                </span>
                                <span className="font-medium">
                                  {participant.fields["Participant Name"]}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>No participants on waitlist</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Dropped From Trip Section */}
            {dropped.length > 0 && (
              <Card className="border-border bg-muted/30">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl font-semibold text-muted-foreground">Dropped From Trip</CardTitle>
                    <Badge variant="secondary" className="text-base px-3 py-1">
                      {dropped.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {dropped.map((participant) => (
                      <div
                        key={participant.id}
                        className="flex items-center justify-between py-3 px-4 rounded-lg border border-border bg-background"
                        data-testid={`dropped-${participant.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-muted-foreground">
                            {participant.fields["Participant Name"]}
                          </span>
                          {participant.fields["Is Driver"] && (
                            <Badge variant="outline" className="gap-1 bg-primary/5 text-primary border-primary/20">
                              <Car className="w-3 h-3" />
                              Driver
                            </Badge>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reAddParticipantMutation.mutate(participant)}
                          disabled={reAddParticipantMutation.isPending}
                          data-testid={`button-readd-${participant.id}`}
                          className="text-primary hover:text-primary hover:bg-primary/10"
                        >
                          <UserPlus className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Actions & Stats */}
          <div className="space-y-6">
            {/* Trip Details Card */}
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Info className="w-5 h-5 text-primary" />
                  Trip Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Trip Type */}
                {trip?.fields["Type of Trip"] && trip.fields["Type of Trip"].length > 0 && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      Trip Type
                    </div>
                    <div className="text-base font-semibold" data-testid="text-trip-type">
                      {trip.fields["Type of Trip"][0]}
                    </div>
                  </div>
                )}

                {/* Dates */}
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Dates
                  </div>
                  <div className="text-base font-semibold" data-testid="text-trip-dates">
                    {trip && format(parseISO(trip.fields["Start Date"]), "MMM d")} - {trip && format(parseISO(trip.fields["End Date"]), "MMM d, yyyy")}
                  </div>
                </div>

                {/* Cost */}
                {trip?.fields["Cost of Trip (per-person)"] && trip.fields["Cost of Trip (per-person)"].length > 0 && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                      <DollarSign className="w-4 h-4" />
                      Cost per Person
                    </div>
                    <div className="text-base font-semibold" data-testid="text-trip-cost">
                      ${trip.fields["Cost of Trip (per-person)"][0]}
                    </div>
                  </div>
                )}

                {/* Drivers Needed */}
                {trip?.fields["Additional Drivers Required"] !== undefined && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                      <Car className="w-4 h-4" />
                      Drivers Needed
                    </div>
                    <div className="text-base font-semibold" data-testid="text-drivers-needed">
                      {trip.fields["Additional Drivers Required"]}
                    </div>
                  </div>
                )}

                {/* Non-Driver Spots */}
                {trip?.fields["Non-Drivers Capacity"] !== undefined && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Non-Driver Spots
                    </div>
                    <div className="text-base font-semibold" data-testid="text-non-driver-spots">
                      {trip.fields["Non-Drivers Capacity"]}
                    </div>
                  </div>
                )}

                {/* Full Status */}
                {trip?.fields["FULL"] && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">
                      Full Status
                    </div>
                    <Badge 
                      variant={trip.fields["FULL"] === "YES" ? "destructive" : "secondary"}
                      className="text-base px-3 py-1"
                      data-testid="badge-full-status"
                    >
                      {trip.fields["FULL"] === "YES" ? "Full" : "Open"}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Stats Card */}
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Trip Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    Total Signups
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-total-signups">
                    {roster.length + waitlist.length}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    Current Roster
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-roster-count">
                    {roster.length}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    Drivers
                  </div>
                  <div className="text-2xl font-bold flex items-center gap-2" data-testid="text-driver-count">
                    <Car className="w-6 h-6 text-primary" />
                    {driverCount}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Actions Card */}
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full h-12 font-medium gap-2"
                  onClick={() => randomizeMutation.mutate()}
                  disabled={randomizeMutation.isPending || roster.length === 0 || !!proposedRoster}
                  data-testid="button-randomize"
                >
                  <Shuffle className="w-4 h-4" />
                  {randomizeMutation.isPending ? "Randomizing..." : "Randomize Roster"}
                </Button>
                {proposedRoster && proposedWaitlist && (
                  <>
                    <Button
                      variant="default"
                      className="w-full h-12 font-medium gap-2 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => approveRandomizationMutation.mutate()}
                      disabled={approveRandomizationMutation.isPending}
                      data-testid="button-approve-roster"
                    >
                      {approveRandomizationMutation.isPending ? "Approving..." : "Approve Roster"}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full h-12 font-medium gap-2"
                      onClick={() => {
                        setProposedRoster(null);
                        setProposedWaitlist(null);
                      }}
                      disabled={approveRandomizationMutation.isPending}
                      data-testid="button-cancel-randomization"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </Button>
                  </>
                )}
                <Button
                  variant="secondary"
                  className="w-full h-12 font-medium gap-2"
                  onClick={() => addDriverMutation.mutate()}
                  disabled={addDriverMutation.isPending || waitlistDrivers.length === 0}
                  data-testid="button-add-driver"
                >
                  <Car className="w-4 h-4" />
                  {addDriverMutation.isPending ? "Adding..." : "Add Driver"}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full h-12 font-medium gap-2"
                  onClick={() => addNonDriverMutation.mutate()}
                  disabled={addNonDriverMutation.isPending || waitlistNonDrivers.length === 0}
                  data-testid="button-add-nondriver"
                >
                  <UserPlus className="w-4 h-4" />
                  {addNonDriverMutation.isPending ? "Adding..." : "Add Non-Driver"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!participantToDelete}
        onOpenChange={(open) => !open && setParticipantToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Participant?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove{" "}
              <span className="font-semibold">
                {participantToDelete?.fields["Participant Name"]}
              </span>{" "}
              from the roster? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-drop">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => participantToDelete && dropParticipantMutation.mutate(participantToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-drop"
            >
              {dropParticipantMutation.isPending ? "Removing..." : "Remove Participant"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
