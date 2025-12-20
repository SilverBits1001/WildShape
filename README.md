# WildShape

WildShape is an Owlbear Rodeo 2 extension that streamlines druid wild shape token swaps and creature summons. It lets you save common forms into a per-scene library, swap your tokens into those forms with a single click, and drop summons using the same artwork and sizing rules.

## Features

- **Transform tab** – Pick a saved form and transform the current character token while preserving original metadata for easy reverts.
- **Summon tab** – Spawn library entries as independent tokens, including bulk unsummon controls and optional placement helpers.
- **Library tab** – GMs can save selected tokens into the shared library with a size category, name, and "show in summons" toggle; supports single saves or guided batch entry.
- **Context menus** – Right-click helpers to open the transform tab, save a token to the library, revert a transformed token, or choose a map position before opening the summon tab.
- **Safety nets** – Every transform stores the original art, size, label, and grid data so a revert restores the exact starting state.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start a dev server that Owlbear Rodeo can reach (include `--host` so OBR can load it):
   ```bash
   npm run dev -- --host
   ```
3. In Owlbear Rodeo, open **Extensions → Add Extension** and enter the dev server URL (e.g., `http://localhost:5173`).
4. For production builds, run `npm run build` and host the generated `dist/` folder. Use the hosted base URL when adding the extension to Owlbear Rodeo.

## Usage

### Transforming a token
1. Select a character token, then open WildShape (tab appears as **Transform**).
2. Use **Transform Options** to choose a target size, swap just the art ("Keep footprint"), or prefix the name with the pawprint indicator.
3. Click a form in **Available Forms** to swap the token. The **Active Wild Shapes** list tracks transformed tokens and offers **Revert All**.
4. Right-click a character token and pick **Wildshape** or **Revert Form** for quick access from the map.

### Summoning creatures
1. Open the **Summon** tab and pick an entry marked as summonable.
2. Choose a placement option (adjacent to the selected summoner or at the stored map position if you opened from the context menu) and summon.
3. The **Active Summons** panel lists current summons with **Unsummon All** for cleanup.

### Managing the library
1. Switch to the **Library** tab.
2. Select a token to preview it, give it a name, choose a size category, and decide if it should appear in the Summon tab.
3. Click **Select a Token** → **Add Shape** to save. Use batch mode to walk through multiple selected tokens quickly.
4. Saved entries appear under **Saved Shapes**, where you can delete unused forms.

## Development Notes

- The extension uses Vite with separate entry points for `index.html` (popover UI) and `background.html` (context menu registration).
- Owlbear Rodeo SDK calls are centralized in `src/main.js` (UI/workflows) and `src/background.js` (background context menu wiring).
- No additional build tooling is required beyond `npm run dev` and `npm run build`.
