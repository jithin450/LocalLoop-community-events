import {
  useEffect,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabasePublicConfig, requireSupabase, storageLimits } from "@/lib/supabase";
import type {
  Category,
  DashboardSummary,
  EventAttendee,
  EventFilters,
  EventInput,
  EventRecord,
  EventReport,
  EventUpdateInput,
  NotificationRecord,
  Profile,
  PublicProfile,
  UploadAssetInput,
  UploadedAsset,
} from "@/lib/types";

const eventSelect = "*, event_categories(category:categories(*))";
const eventsKey = ["events"] as const;
const savedEventsKey = ["saved-events"] as const;
const myEventsKey = ["my-events"] as const;
const dashboardKey = ["dashboard-summary"] as const;
const notificationsKey = ["notifications"] as const;
const reportsKey = ["admin-reports"] as const;
const reportStatuses = ["pending", "reviewed", "dismissed", "actioned"] as const;

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await requireSupabase().auth.getUser();
  if (error) throw error;
  return data.user?.id ?? null;
}

function relationCategories(links: unknown): Category[] {
  if (!Array.isArray(links)) return [];
  return links
    .map((link) => {
      if (!link || typeof link !== "object") return null;
      const category = (link as { category?: Category | Category[] | null }).category;
      return Array.isArray(category) ? (category[0] ?? null) : category;
    })
    .filter((category): category is Category => !!category && !!category.id);
}

async function getPublicProfiles(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map<string, PublicProfile>();
  const { data, error } = await requireSupabase()
    .from("public_profiles")
    .select("*")
    .in("id", ids);
  throwIfError(error);
  return new Map(
    ((data ?? []) as PublicProfile[]).map((profile) => [profile.id, profile]),
  );
}

async function addEventViewerState(
  rows: Record<string, unknown>[],
  userId: string | null,
): Promise<EventRecord[]> {
  if (!rows.length) return [];
  const client = requireSupabase();
  const ids = rows.map((row) => String(row.id));
  const organizerIds = rows.map((row) => String(row.organizer_id));
  const [profiles, attendanceResult, savedResult] = await Promise.all([
    getPublicProfiles(organizerIds),
    userId
      ? client
          .from("event_attendees")
          .select("event_id,status")
          .eq("user_id", userId)
          .in("event_id", ids)
      : Promise.resolve({ data: [], error: null }),
    userId
      ? client
          .from("saved_events")
          .select("event_id")
          .eq("user_id", userId)
          .in("event_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  throwIfError(attendanceResult.error);
  throwIfError(savedResult.error);

  const goingIds = new Set(
    ((attendanceResult.data ?? []) as { event_id: string; status: string }[])
      .filter((item) => item.status === "going")
      .map((item) => item.event_id),
  );
  const savedIds = new Set(
    ((savedResult.data ?? []) as { event_id: string }[]).map((item) => item.event_id),
  );

  return rows.map((row) => ({
    ...(row as unknown as Omit<EventRecord, "categories" | "organizer" | "isGoing" | "isSaved">),
    categories: relationCategories(row.event_categories),
    organizer: profiles.get(String(row.organizer_id)) ?? null,
    isGoing: goingIds.has(String(row.id)),
    isSaved: savedIds.has(String(row.id)),
  }));
}

function distanceInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchEventRows(filters: EventFilters = {}) {
  const client = requireSupabase();
  const search = filters.query?.trim();
  const searchFields = search
    ? ["title", "description", "location_name", "city"]
    : [null];

  const resultSets = await Promise.all(
    searchFields.map(async (field) => {
      let request = client.from("events").select(eventSelect);
      if (!filters.includePast) {
        request = request.gte("start_time", new Date().toISOString());
      }
      if (filters.from) request = request.gte("start_time", filters.from);
      if (filters.to) request = request.lte("start_time", filters.to);
      if (filters.city?.trim()) {
        request = request.ilike("city", `%${filters.city.trim()}%`);
      }
      if (filters.categoryId) {
        request = request.eq("event_categories.category_id", filters.categoryId);
      }
      if (filters.onlineOnly) request = request.eq("is_online", true);
      if (search && field) request = request.ilike(field, `%${search}%`);
      request = request
        .eq("status", "published")
        .order(filters.sort === "newest" ? "created_at" : "start_time", {
          ascending: filters.sort !== "newest",
        })
        .limit(200);
      const { data, error } = await request;
      throwIfError(error);
      return (data ?? []) as unknown as Record<string, unknown>[];
    }),
  );

  const unique = new Map<string, Record<string, unknown>>();
  for (const rows of resultSets) {
    for (const row of rows) unique.set(String(row.id), row);
  }
  let events = await addEventViewerState([...unique.values()], await getCurrentUserId());

  if (
    typeof filters.latitude === "number" &&
    typeof filters.longitude === "number"
  ) {
    events = events
      .map((event) => {
        if (event.latitude == null || event.longitude == null) return event;
        return {
          ...event,
          distanceKm: distanceInKm(
            filters.latitude!,
            filters.longitude!,
            event.latitude,
            event.longitude,
          ),
        };
      })
      .filter(
        (event) =>
          filters.radiusKm == null ||
          (event.distanceKm != null && event.distanceKm <= filters.radiusKm),
      );
  }

  if (filters.sort === "nearby" && typeof filters.latitude === "number") {
    events.sort(
      (left, right) =>
        (left.distanceKm ?? Number.POSITIVE_INFINITY) -
        (right.distanceKm ?? Number.POSITIVE_INFINITY),
    );
  }
  return events;
}

async function fetchOneEvent(id: string): Promise<EventRecord> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("events")
    .select(eventSelect)
    .eq("id", id)
    .maybeSingle();
  throwIfError(error);
  if (!data) throw new Error("This event could not be found or is no longer available.");
  const userId = await getCurrentUserId();
  const [event] = await addEventViewerState(
    [data as unknown as Record<string, unknown>],
    userId,
  );
  return event;
}

async function fetchSavedEvents(userId: string): Promise<EventRecord[]> {
  const client = requireSupabase();
  const { data: savedRows, error: savedError } = await client
    .from("saved_events")
    .select("event_id,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  throwIfError(savedError);
  const ids = (savedRows ?? []).map((row: { event_id: string }) => row.event_id);
  if (!ids.length) return [];
  const { data, error } = await client
    .from("events")
    .select(eventSelect)
    .in("id", ids);
  throwIfError(error);
  const events = await addEventViewerState(
    (data ?? []) as unknown as Record<string, unknown>[],
    userId,
  );
  const byId = new Map(events.map((event) => [event.id, event]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

async function fetchMyEvents(userId: string): Promise<EventRecord[]> {
  const client = requireSupabase();
  const [ownedResult, attendeeResult] = await Promise.all([
    client.from("events").select("id").eq("organizer_id", userId),
    client
      .from("event_attendees")
      .select("event_id")
      .eq("user_id", userId)
      .eq("status", "going"),
  ]);
  throwIfError(ownedResult.error);
  throwIfError(attendeeResult.error);
  const hosted = new Set(
    ((ownedResult.data ?? []) as { id: string }[]).map((row) => row.id),
  );
  const joined = new Set(
    ((attendeeResult.data ?? []) as { event_id: string }[]).map((row) => row.event_id),
  );
  const ids = [...new Set([...hosted, ...joined])];
  if (!ids.length) return [];
  const { data, error } = await client
    .from("events")
    .select(eventSelect)
    .in("id", ids)
    .order("start_time", { ascending: true });
  throwIfError(error);
  const events = await addEventViewerState(
    (data ?? []) as unknown as Record<string, unknown>[],
    userId,
  );
  return events.map((event) => ({
    ...event,
    membership:
      hosted.has(event.id) && joined.has(event.id)
        ? "both"
        : hosted.has(event.id)
          ? "hosting"
          : "attending",
  }));
}

async function createEvent(input: EventInput): Promise<EventRecord> {
  const client = requireSupabase();
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to create an event.");
  const { category_ids: categoryIds, ...eventInput } = input;
  const { data, error } = await client
    .from("events")
    .insert({ ...eventInput, organizer_id: userId })
    .select("id")
    .single();
  throwIfError(error);
  if (!data) throw new Error("The event was not created.");
  const { error: categoryError } = await client.rpc("set_event_categories", {
    p_event_id: data.id,
    p_category_ids: categoryIds,
  });
  if (categoryError) {
    await client.from("events").delete().eq("id", data.id);
    throw new Error(categoryError.message);
  }
  return fetchOneEvent(data.id);
}

async function updateEvent({
  id,
  input,
}: {
  id: string;
  input: EventUpdateInput;
}): Promise<EventRecord> {
  const client = requireSupabase();
  const { category_ids: categoryIds, ...eventInput } = input;
  if (Object.keys(eventInput).length) {
    const { error } = await client.from("events").update(eventInput).eq("id", id);
    throwIfError(error);
  }
  if (categoryIds) {
    const { error } = await client.rpc("set_event_categories", {
      p_event_id: id,
      p_category_ids: categoryIds,
    });
    throwIfError(error);
  }
  return fetchOneEvent(id);
}

function storedObjectPath(publicUrl: string | null, bucket: string) {
  if (!publicUrl) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const index = publicUrl.indexOf(marker);
  if (index < 0) return null;
  try {
    return decodeURIComponent(publicUrl.slice(index + marker.length));
  } catch {
    return publicUrl.slice(index + marker.length);
  }
}

async function deleteEvent(id: string) {
  const client = requireSupabase();
  const { data: event, error: readError } = await client
    .from("events")
    .select("cover_image_url")
    .eq("id", id)
    .maybeSingle();
  throwIfError(readError);
  if (!event) throw new Error("This event could not be found or you cannot remove it.");
  const { error } = await client.from("events").delete().eq("id", id);
  throwIfError(error);
  const imagePath = storedObjectPath(event.cover_image_url, "event-images");
  if (imagePath) {
    const { error: storageError } = await client.storage
      .from("event-images")
      .remove([imagePath]);
    if (storageError) {
      console.warn("LocalLoop could not clean up a deleted event image.", storageError.message);
    }
  }
  return id;
}

async function rsvpToEvent(eventId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("rsvp_to_event", {
    p_event_id: eventId,
  });
  throwIfError(error);
  return data;
}

async function cancelRsvp(eventId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("cancel_event_rsvp", {
    p_event_id: eventId,
  });
  throwIfError(error);
  return Boolean(data);
}

async function toggleSavedEvent(eventId: string, userId: string) {
  const client = requireSupabase();
  const { data: existing, error: selectError } = await client
    .from("saved_events")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(selectError);
  if (existing) {
    const { error } = await client
      .from("saved_events")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", userId);
    throwIfError(error);
    return false;
  }
  const { error } = await client
    .from("saved_events")
    .insert({ event_id: eventId, user_id: userId });
  throwIfError(error);
  return true;
}

async function updateProfile(input: Partial<Profile>): Promise<Profile> {
  const client = requireSupabase();
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to update your profile.");
  const allowed = {
    full_name: input.full_name,
    username: input.username,
    avatar_url: input.avatar_url,
    bio: input.bio,
    city: input.city,
    interests: input.interests,
  };
  const patch = Object.fromEntries(
    Object.entries(allowed).filter(([, value]) => value !== undefined),
  );
  const { data, error } = await client
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .single();
  throwIfError(error);
  if (!data) throw new Error("Your profile could not be updated.");
  return data as Profile;
}

async function uploadAsset(input: UploadAssetInput): Promise<UploadedAsset> {
  const client = requireSupabase();
  const { file, bucket } = input;
  const maxBytes =
    bucket === "avatars" ? storageLimits.avatarBytes : storageLimits.eventImageBytes;
  if (!storageLimits.mimeTypes.includes(file.type as (typeof storageLimits.mimeTypes)[number])) {
    throw new Error("Choose a JPG, PNG, or WEBP image.");
  }
  if (file.size > maxBytes) {
    throw new Error(
      `Image must be smaller than ${bucket === "avatars" ? "5 MB" : "8 MB"}.`,
    );
  }
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  throwIfError(sessionError);
  const session = sessionData.session;
  if (!session) throw new Error("Sign in before uploading an image.");

  const userId = session.user.id;
  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const path =
    bucket === "avatars"
      ? `${userId}/${fileName}`
      : `${userId}/${input.eventId ?? "draft"}/${fileName}`;
  const { url, anonKey } = getSupabasePublicConfig();
  const objectUrl = `${url.replace(/\/$/, "")}/storage/v1/object/${bucket}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", objectUrl);
    request.setRequestHeader("apikey", anonKey);
    request.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    request.setRequestHeader("Content-Type", file.type);
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        input.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () => reject(new Error("Image upload failed. Check your connection and retry."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        input.onProgress?.(100);
        resolve();
        return;
      }
      let message = "Image upload failed.";
      try {
        const body = JSON.parse(request.responseText) as { message?: string; error?: string };
        message = body.message ?? body.error ?? message;
      } catch {
        // Keep the safe generic error if Storage returned a non-JSON response.
      }
      reject(new Error(message));
    };
    request.send(file);
  });

  const { data } = client.storage.from(bucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

async function fetchAttendees(eventId: string): Promise<EventAttendee[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("event_attendees")
    .select("id,event_id,user_id,status,created_at")
    .eq("event_id", eventId)
    .eq("status", "going")
    .order("created_at", { ascending: true });
  throwIfError(error);
  const rows = (data ?? []) as Omit<EventAttendee, "profile">[];
  const profiles = await getPublicProfiles(rows.map((row) => row.user_id));
  return rows.map((row) => ({
    ...row,
    profile: profiles.get(row.user_id) ?? null,
  }));
}

async function fetchDashboardSummary(
  userId: string,
  isAdmin: boolean,
): Promise<DashboardSummary> {
  const client = requireSupabase();
  let eventsRequest = client
    .from("events")
    .select(eventSelect)
    .eq("organizer_id", userId)
    .order("start_time", { ascending: true });
  const { data, error } = await eventsRequest;
  throwIfError(error);
  const events = await addEventViewerState(
    (data ?? []) as unknown as Record<string, unknown>[],
    userId,
  );
  let pendingReports = 0;
  if (isAdmin) {
    const { count, error: reportsError } = await client
      .from("event_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    throwIfError(reportsError);
    pendingReports = count ?? 0;
  }
  const now = Date.now();
  return {
    events,
    totalEvents: events.length,
    upcomingEvents: events.filter(
      (event) => event.status === "published" && Date.parse(event.start_time) >= now,
    ).length,
    totalRsvps: events.reduce((sum, event) => sum + event.attendee_count, 0),
    pendingReports,
  };
}

async function fetchAdminReports(): Promise<EventReport[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("event_reports")
    .select("*, event:events(id,title,city,start_time,status)")
    .order("created_at", { ascending: false });
  throwIfError(error);
  const rows = (data ?? []) as EventReport[];
  const profiles = await getPublicProfiles(rows.map((row) => row.reported_by));
  return rows.map((row) => ({
    ...row,
    reporter: profiles.get(row.reported_by) ?? null,
  }));
}

async function uploadWithProgress(input: UploadAssetInput) {
  return uploadAsset(input);
}

function invalidateEventViews(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: eventsKey });
  void queryClient.invalidateQueries({ queryKey: savedEventsKey });
  void queryClient.invalidateQueries({ queryKey: myEventsKey });
  void queryClient.invalidateQueries({ queryKey: dashboardKey });
  void queryClient.invalidateQueries({ queryKey: reportsKey });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from("categories")
        .select("*")
        .order("name");
      throwIfError(error);
      return (data ?? []) as Category[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useEvents(filters: EventFilters = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...eventsKey, filters, user?.id ?? null],
    queryFn: () => fetchEventRows(filters),
    staleTime: 30_000,
    refetchOnMount: "always",
  });
}

export function useEvent(id: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...eventsKey, "detail", id, user?.id ?? null],
    queryFn: () => fetchOneEvent(id!),
    enabled: !!id,
    staleTime: 15_000,
    refetchOnMount: "always",
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createEvent,
    onSuccess: () => invalidateEventViews(queryClient),
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateEvent,
    onSuccess: (event) => {
      invalidateEventViews(queryClient);
      void queryClient.invalidateQueries({ queryKey: [...eventsKey, "detail", event.id] });
    },
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteEvent,
    onSuccess: () => invalidateEventViews(queryClient),
  });
}

export function useRsvpToEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rsvpToEvent,
    onSuccess: () => invalidateEventViews(queryClient),
  });
}

export function useCancelRsvp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelRsvp,
    onSuccess: () => invalidateEventViews(queryClient),
  });
}

export function useToggleSavedEvent() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => {
      if (!user) throw new Error("Sign in to save events.");
      return toggleSavedEvent(eventId, user.id);
    },
    onSuccess: () => invalidateEventViews(queryClient),
  });
}

export function useSavedEvents() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...savedEventsKey, user?.id ?? null],
    queryFn: () => {
      if (!user) throw new Error("Sign in to view saved events.");
      return fetchSavedEvents(user.id);
    },
    enabled: !!user,
    staleTime: 15_000,
    refetchOnMount: "always",
  });
}

export function useMyEvents() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...myEventsKey, user?.id ?? null],
    queryFn: () => {
      if (!user) throw new Error("Sign in to view your events.");
      return fetchMyEvents(user.id);
    },
    enabled: !!user,
    staleTime: 15_000,
    refetchOnMount: "always",
  });
}

export function useEventAttendees(eventId: string | undefined) {
  return useQuery({
    queryKey: ["event-attendees", eventId],
    queryFn: () => fetchAttendees(eventId!),
    enabled: !!eventId,
    staleTime: 15_000,
    refetchOnMount: "always",
  });
}

export function useDashboardSummary() {
  const { user, profile } = useAuth();
  return useQuery({
    queryKey: [...dashboardKey, user?.id ?? null],
    queryFn: () => {
      if (!user) throw new Error("Sign in to view organizer analytics.");
      return fetchDashboardSummary(user.id, profile?.role === "admin");
    },
    enabled: !!user,
    staleTime: 20_000,
    refetchOnMount: "always",
  });
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
  });
}

export function useReportEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      event_id: string;
      reason: string;
      description?: string | null;
    }) => {
      const userId = await getCurrentUserId();
      if (!userId) throw new Error("Sign in to report an event.");
      const { data, error } = await requireSupabase()
        .from("event_reports")
        .insert({
          event_id: input.event_id,
          reported_by: userId,
          reason: input.reason,
          description: input.description ?? null,
        })
        .select("*")
        .single();
      throwIfError(error);
      return data as EventReport;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reportsKey });
    },
  });
}

export function useNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!user) return;
    const client = requireSupabase();
    const channel = client
      .channel(`localloop-notifications-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: [...notificationsKey, user.id],
          });
        },
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [queryClient, user]);

  const query = useQuery({
    queryKey: [...notificationsKey, user?.id ?? null],
    queryFn: async () => {
      if (!user) throw new Error("Sign in to view notifications.");
      const { data, error } = await requireSupabase()
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      throwIfError(error);
      return (data ?? []) as NotificationRecord[];
    },
    enabled: !!user,
    staleTime: 15_000,
    refetchOnMount: "always",
  });

  return query;
}

export function useMarkNotificationRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      if (!user) throw new Error("Sign in to update notifications.");
      const { error } = await requireSupabase()
        .from("notifications")
        .update({ read: true })
        .eq("id", notificationId)
        .eq("user_id", user.id);
      throwIfError(error);
      return notificationId;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsKey });
    },
  });
}

export function useUploadAsset() {
  return useMutation({
    mutationFn: uploadWithProgress,
  });
}

export function useAdminReports() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: reportsKey,
    queryFn: fetchAdminReports,
    enabled: profile?.role === "admin",
    staleTime: 10_000,
    refetchOnMount: "always",
  });
}

export function useUpdateReportStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      reportId,
      status,
    }: {
      reportId: string;
      status: (typeof reportStatuses)[number];
    }) => {
      const { data, error } = await requireSupabase()
        .from("event_reports")
        .update({ status })
        .eq("id", reportId)
        .select("*")
        .single();
      throwIfError(error);
      return data as EventReport;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reportsKey });
      void queryClient.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

export function useModerateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      eventId,
      status,
    }: {
      eventId: string;
      status: EventRecord["status"];
    }) => {
      const { data, error } = await requireSupabase()
        .from("events")
        .update({ status })
        .eq("id", eventId)
        .select("*")
        .single();
      throwIfError(error);
      return data as EventRecord;
    },
    onSuccess: () => invalidateEventViews(queryClient),
  });
}
