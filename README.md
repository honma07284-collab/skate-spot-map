# ROLL CALL

A full-screen map for recording skate spots. The MVP stores spot details and photos in the current browser; it has no server database or account sync.

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
- Spot details stay in `localStorage` and photos in `IndexedDB` in this browser; data is not shared across devices.
- The interface is designed for phone screens; use the bottom `スポットを追加` button or tap the map to start.

## Main packages

- `next`, `react`, and `react-dom` for the application.
- `maplibre-gl` for the interactive map.
- `lucide-react` for interface icons.

The map uses public OpenStreetMap tiles and requires an internet connection. Saved spots are local to each browser, so phone data is separate from data saved on the PC.