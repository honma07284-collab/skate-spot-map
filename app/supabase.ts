import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

export const AVATARS = ["🛹", "🧢", "🦊", "🐈", "🌵", "🍊", "🎧", "🌀"] as const;
export type Avatar = (typeof AVATARS)[number];

export type Profile = {
  id: string;
  username: string;
  avatar: Avatar;
};

export type CloudSpot = {
  id: string;
  owner_id: string;
  name: string;
  note: string;
  types: string[];
  has_photo: boolean;
  photo_path: string | null;
  lng: number;
  lat: number;
};

export function authEmailForUsername(username: string) {
  return `${username.trim().toLowerCase()}@users.rollcall.example.com`;
}
