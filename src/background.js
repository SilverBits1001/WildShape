import OBR, { isImage } from "@owlbear-rodeo/sdk";

const ID = "com.tutorial.wildshape";
const METADATA_ORIGINAL = `${ID}/original`;
const METADATA_STATE = `${ID}/state`;
const REQUEST_SUMMON_POSITION_KEY = `${ID}:summonPosition`;

// Optional: lets the popover know what the user wanted to do.
// Safe even if your main.js ignores it.
const OPEN_TAB_KEY = `${ID}:openTab`;
const OPEN_ITEM_KEY = `${ID}:openItemId`;

function requestOpen(tab, itemId) {
  try {
    localStorage.setItem(OPEN_TAB_KEY, tab);
    if (itemId) localStorage.setItem(OPEN_ITEM_KEY, itemId);
    else localStorage.removeItem(OPEN_ITEM_KEY);
  } catch (_) {
    // ignore (localStorage can be blocked in some contexts)
  }
}

async function updateItemsByIds(ids, updater) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const items = await OBR.scene.items.getItems(ids);
  if (!items || items.length === 0) return;
  await OBR.scene.items.updateItems(items, updater);
}

async function restoreItems(ids) {
  try {
    await updateItemsByIds(ids, (items) => {
      for (const item of items) {
        if (!isImage(item) || !item.image || !item.grid || !item.metadata) continue;

        const original = item.metadata[METADATA_ORIGINAL];
        if (!original) continue;

        if (original.url) item.image.url = original.url;
        if (typeof original.imgWidth === "number") item.image.width = original.imgWidth;
        if (typeof original.imgHeight === "number") item.image.height = original.imgHeight;
        if (typeof original.gridDpi === "number") item.grid.dpi = original.gridDpi;

        if (original.scale && typeof original.scale.x === "number" && typeof original.scale.y === "number") {
          item.scale = { x: original.scale.x, y: original.scale.y };
        }

        if (typeof original.rotation === "number") item.rotation = original.rotation;

        if (item.text && typeof original.name === "string") {
          item.text.plainText = original.name;
        }

        const w = Number(original.imgWidth || item.image.width || 0);
        const h = Number(original.imgHeight || item.image.height || 0);

        if (original.gridOffset && !Array.isArray(original.gridOffset)) {
          item.grid.offset = original.gridOffset;
        } else if (w && h) {
          item.grid.offset = { x: w / 2, y: h / 2 };
        }

        delete item.metadata[METADATA_ORIGINAL];
        delete item.metadata[METADATA_STATE];
      }
    });

    OBR.notification.show("Reverted to original form");
  } catch (e) {
    console.error(e);
    OBR.notification.show("Error reverting form.", "ERROR");
  }
}

async function setupContextMenus() {
  const iconUrl = await OBR.assets.getUrl("/icon.svg");

  // 1) Wild Shape (open extension to Transform tab)
  OBR.contextMenu.create({
    id: `${ID}/ctx-open-wildshape`,
    icons: [
      {
        icon: iconUrl,
        label: "Wildshape",
        filter: {
          min: 1,
          max: 1,
          every: [{ key: "layer", value: "CHARACTER" }],
        },
      },
    ],
    onClick: async (context) => {
      const item = context.items?.[0];
      requestOpen("view-transform", item?.id);
      await OBR.action.open();
    },
  });

  // 2) Save as Shape (GM only, open extension to Library tab)
  OBR.contextMenu.create({
    id: `${ID}/ctx-save-as-shape`,
    icons: [
      {
        icon: iconUrl,
        label: "Add Shape",
        filter: {
          min: 1,
          max: 1,
          roles: ["GM"],
          every: [{ key: "layer", value: "CHARACTER" }],
        },
      },
    ],
    onClick: async (context) => {
      const item = context.items?.[0];
      requestOpen("view-library", item?.id);
      await OBR.action.open();
    },
  });

  // 3) Revert Shape (only when wildshaped metadata exists)
  OBR.contextMenu.create({
    id: `${ID}/ctx-revert-shape`,
    icons: [
      {
        icon: iconUrl,
        label: "Revert Form",
        filter: {
          min: 1,
          max: 1,
          every: [
            { key: "layer", value: "CHARACTER" },
            { key: ["metadata", METADATA_ORIGINAL], operator: "!=", value: undefined },
          ],
        },
      },
    ],
    onClick: async (context) => {
      const item = context.items?.[0];
      if (!item?.id) return;
      await restoreItems([item.id]);
    },
  });

  // 4) Summon Familiar (map context)
  OBR.contextMenu.create({
    id: `${ID}/ctx-summon-familiar`,
    icons: [
      {
        icon: iconUrl,
        label: "Summon Familiar…",
        filter: {
          min: 0,
          max: 0,
        },
      },
    ],
    onClick: async (context) => {
      const pos =
        context?.position ||
        context?.worldPosition ||
        context?.cursorPosition ||
        context?.pointerPosition ||
        null;

      if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
        try {
          localStorage.setItem(REQUEST_SUMMON_POSITION_KEY, JSON.stringify(pos));
        } catch (_) {}
      }

      requestOpen("view-summons");
      await OBR.action.open();
    },
  });
}

OBR.onReady(() => {
  console.log("[WildShape] Background Ready");
  void setupContextMenus();
});
