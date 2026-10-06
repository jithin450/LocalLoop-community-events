export type AccountRole = "participant" | "organizer" | "admin";

export interface Profile {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  interests: string[];
  role: AccountRole;
  created_at: string;
  updated_at: string;
}

export type PublicProfile = Omit<Profile, "email" | "updated_at">;

export interface Category {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  created_at: string;
}

export interface EventRecord {
  id: string;
  organizer_id: string;
  title: string;
  description: string;
  cover_image_url: string | null;
  location_name: string;
  address: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  start_time: string;
  end_time: string | null;
  capacity: number | null;
  attendee_count: number;
  is_online: boolean;
  online_url: string | null;
  status: "draft" | "published" | "cancelled" | "completed";
  created_at: string;
  updated_at: string;
  categories: Category[];
  organizer: PublicProfile | null;
  isGoing: boolean;
  isSaved: boolean;
  distanceKm?: number;
  membership?: "hosting" | "attending" | "both";
}

export interface EventInput {
  title: string;
  description: string;
  cover_image_url?: string | null;
  location_name: string;
  address?: string | null;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
  start_time: string;
  end_time?: string | null;
  capacity?: number | null;
  is_online: boolean;
  online_url?: string | null;
  status?: EventRecord["status"];
  category_ids: string[];
}

export type EventUpdateInput = Partial<EventInput>;

export interface EventFilters {
  query?: string;
  city?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  onlineOnly?: boolean;
  includePast?: boolean;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  sort?: "soonest" | "newest" | "nearby";
}

export interface EventAttendee {
  id: string;
  event_id: string;
  user_id: string;
  status: "going" | "cancelled";
  created_at: string;
  profile: PublicProfile | null;
}

export interface EventReport {
  id: string;
  event_id: string;
  reported_by: string;
  reason: string;
  description: string | null;
  status: "pending" | "reviewed" | "dismissed" | "actioned";
  created_at: string;
  event?: Pick<EventRecord, "id" | "title" | "city" | "start_time" | "status"> | null;
  reporter?: Pick<PublicProfile, "id" | "full_name" | "username" | "avatar_url"> | null;
}

export interface NotificationRecord {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  event_id: string | null;
  created_at: string;
}

export interface DashboardSummary {
  events: EventRecord[];
  totalEvents: number;
  upcomingEvents: number;
  totalRsvps: number;
  pendingReports: number;
}

export interface UploadAssetInput {
  file: File;
  bucket: "avatars" | "event-images";
  eventId?: string;
  onProgress?: (progress: number) => void;
}

export interface UploadedAsset {
  path: string;
  publicUrl: string;
}
