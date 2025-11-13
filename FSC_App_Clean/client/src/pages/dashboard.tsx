import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LogOut, Calendar, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { TripsResponse } from "@shared/schema";
import { format, parseISO } from "date-fns";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<TripsResponse>({
    queryKey: ["/api/airtable/trips"],
  });

  const handleLogout = () => {
    localStorage.removeItem("fieldstudies_auth");
    setLocation("/");
    toast({
      title: "Logged out",
      description: "You have been successfully logged out",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Open":
        return "bg-primary/10 text-primary border-primary/20";
      case "Waitlist":
        return "bg-chart-4/10 text-chart-4 border-chart-4/20";
      case "Full":
        return "bg-destructive/10 text-destructive border-destructive/20";
      case "Completed":
        return "bg-muted text-muted-foreground border-muted";
      default:
        return "bg-secondary text-secondary-foreground border-secondary";
    }
  };

  const formatDateRange = (startDate: string, endDate: string) => {
    try {
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      return `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`;
    } catch {
      return `${startDate} - ${endDate}`;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-xl font-bold">Field Studies Trip Manager</h1>
          </div>
          <Button
            variant="ghost"
            onClick={handleLogout}
            data-testid="button-logout"
            className="gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Upcoming Trips</h2>
          <p className="text-muted-foreground">
            Manage rosters and waitlists for all scheduled trips
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-border">
                <CardHeader>
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full" />
                </CardContent>
                <CardFooter>
                  <Skeleton className="h-10 w-full" />
                </CardFooter>
              </Card>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive">Error Loading Trips</CardTitle>
              <CardDescription>
                {error instanceof Error ? error.message : "Failed to fetch trips from Airtable"}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* Trips Grid */}
        {data?.trips && data.trips.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {data.trips.map((trip) => (
              <Card
                key={trip.id}
                className="border-border hover-elevate transition-all duration-200"
                data-testid={`card-trip-${trip.id}`}
              >
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg font-semibold leading-tight">
                      {trip.fields["Trip Name"]}
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={getStatusColor(trip.fields.Status)}
                      data-testid={`badge-status-${trip.id}`}
                    >
                      {trip.fields.Status}
                    </Badge>
                  </div>
                  <CardDescription className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4" />
                    {formatDateRange(trip.fields["Start Date"], trip.fields["End Date"])}
                  </CardDescription>
                </CardHeader>
                <CardFooter className="pt-4">
                  <Button
                    className="w-full h-12 font-medium"
                    variant="secondary"
                    onClick={() => setLocation(`/trip/${trip.id}`)}
                    data-testid={`button-manage-${trip.id}`}
                  >
                    Manage Trip
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}

        {/* Empty State */}
        {data?.trips && data.trips.length === 0 && (
          <Card className="border-dashed">
            <CardHeader className="text-center py-12">
              <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Calendar className="w-8 h-8 text-muted-foreground" />
              </div>
              <CardTitle>No Trips Found</CardTitle>
              <CardDescription className="max-w-md mx-auto">
                There are currently no trips in your Airtable base. Create a trip in Airtable to get started.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </main>
    </div>
  );
}
