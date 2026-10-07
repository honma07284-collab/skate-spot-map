# ROLL CALL

A full-screen map for recording skate spots. Without Supabase configuration, spot details and photos stay in the current browser. With Supabase configured, users can sign in with an ID and password, sync spots across devices, and share spots with approved friends.

## Run locally

```bash
npm install
npm run dev
```

On the PC, open the local URL printed by Next.js. To use the app on a phone, connect the phone to the same Wi-Fi and open `http://<PC's local IP>:<port>` using the network URL printed by Next.js. The dev server listens on the local network. Allow Node.js through Windows Firewall on private networks if prompted.

## Features

- Click the map to add a spot at that coordinate.
- Add a name and optional note, and select one or more sections: rail, curb, flat, and bank.
- Attach one optional photo to a spot from the camera or photo library.
- Browse, filter, focus, and delete saved spots.
- Move the map to your current location using the location control.
- Sign up with a unique ID and password, choose a profile icon, search for friends by ID, and approve or reject requests.
- Logged-in users see their own spots and spots belonging to accepted friends. Pending requests do not grant access.
- Move existing spots from this browser to an account from the account panel. The import is explicit and safe to repeat.
- Without account configuration, spot details stay in `localStorage` and photos in `IndexedDB` in this browser.
- The interface is designed for phone screens; use the bottom `スポットを追加` button or tap the map to start.

## Configure account sync

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and fill in the Project URL and anon/publishable key from the Supabase project API settings.
3. In Supabase Authentication settings, turn off email confirmations. This app uses the chosen ID as its login identifier and does not collect an email address, so confirmation and password-reset emails are unavailable.
4. Open the Supabase SQL Editor and run `supabase/schema.sql` once. It creates the profile, spot, friend, and private photo-storage policies.
5. Restart the dev server. Open the account panel to register an ID and password.

The app only needs the public anon/publishable key in the browser. Never put a Supabase service-role key in `.env.local` or any `NEXT_PUBLIC_` variable. Row-level security limits spot reads to their owner and accepted friends; private photo URLs are short-lived.

## Main packages

- `next`, `react`, and `react-dom` for the application.
- `@supabase/supabase-js` for authentication, shared data, and private photo storage.
- `maplibre-gl` for the interactive map.
- `lucide-react` for interface icons.

The map uses public OpenStreetMap tiles and requires an internet connection. Before Supabase is configured, saved spots are local to each browser, so phone data is separate from data saved on the PC.