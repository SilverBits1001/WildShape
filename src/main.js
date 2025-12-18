import OBR from "@owlbear-rodeo/sdk";
import "./style.css";

const ID = "com.tutorial.wildshape";
const METADATA_LIBRARY = `${ID}/library`;
const METADATA_ORIGINAL = `${ID}/original`;

let availableShapes = [];
let currentSelectedImage = null;

OBR.onReady(async () => {
  console.log("[WildShape] Extension Ready");
  
  // --- 1. CONTEXT MENUS ---
  OBR.contextMenu.create({
    id: `${ID}/open-menu`,
    icons: [
      {
        icon: "/icon.svg",
        label: "Wild Shape",
        filter: {
          every: [
            { key: "layer", value: "CHARACTER" }
          ]
        }
      }
    ],
    onClick: (context) => {
        OBR.action.open();
    }
  });

  OBR.contextMenu.create({
    id: `${ID}/revert`,
    icons: [
      {
        icon: "/revert.svg",
        label: "Revert Form",
        filter: {
          every: [
            { key: "layer", value: "CHARACTER" },
            { key: ["metadata", METADATA_ORIGINAL], operator: "!=", value: undefined } 
          ],
        },
      },
    ],
    onClick: handleRevert
  });


  // --- 2. UI INITIALIZATION ---
  const app = document.querySelector('#app');
  if (app) {
    // A. Setup Tabs
    setupTabs();
    
    // B. Check Permissions & Adjust UI
    try {
        const role = await OBR.player.getRole();
        console.log("[WildShape] Current Player Role:", role);

        const libTab = document.querySelector('.tab[data-target="view-library"]');
        
        if (libTab) {
            // Rename as requested
            libTab.innerText = "Manage Library";
            
            // Hide if not GM (Case Insensitive Check)
            if (role && role.toUpperCase() !== "GM") {
                console.log("[WildShape] Hiding library tab (User is not GM)");
                libTab.style.display = "none";
                
                // If we are not GM, force switch to transform tab
                const transformTab = document.querySelector('.tab[data-target="view-transform"]');
                if (transformTab) transformTab.click();
            } else {
                console.log("[WildShape] Showing library tab (User is GM)");
            }
        }
    } catch (error) {
        console.error("[WildShape] Error checking role:", error);
    }
    
    // C. Load Data
    const metadata = await OBR.room.getMetadata();
    if (metadata[METADATA_LIBRARY]) {
        availableShapes = metadata[METADATA_LIBRARY];
        renderShapeList();
        renderLibraryList();
    }

    // D. Listeners
    OBR.room.onMetadataChange((metadata) => {
        const data = metadata[METADATA_LIBRARY];
        if (data) {
            availableShapes = data;
            renderShapeList();
            renderLibraryList();
        }
    });

    OBR.player.onChange((player) => {
        updateSelectionUI(player.selection);
    });
    
    // Initial UI Setup
    const selection = await OBR.player.getSelection();
    updateSelectionUI(selection);
  }
});

// --- CORE FUNCTIONS ---

async function applyShape(shape) {
  const selection = await OBR.player.getSelection();
  
  if (!selection || selection.length === 0) {
      OBR.notification.show("Select a token to transform first.", "WARNING");
      return;
  }

  // BASIC VERSION: Only swaps URL. No sizing logic.
  await OBR.scene.items.updateItems(selection, (items) => {
    for (let item of items) {
      // Safety: Only work on images
      if (!item.image) continue;

      // Ensure metadata exists
      if (!item.metadata) item.metadata = {};

      // 1. SAVE ORIGINAL STATS (Minimal)
      if (!item.metadata[METADATA_ORIGINAL]) {
        const savedData = {
            url: item.image.url,
            scale: item.scale,
            width: item.image.width,
            height: item.image.height,
            rotation: item.rotation,
            offset: item.image.offset
        };
        // FAILSAFE: Only save the name if the token actually has a text label
        if (item.text && item.text.plainText) {
            savedData.name = item.text.plainText;
        }
        item.metadata[METADATA_ORIGINAL] = savedData;
      }

      // 2. APPLY NEW LOOK
      // We ONLY change the URL. 
      // Width, Height, Scale, and Offset remain untouched to preserve original size.
      item.image.url = shape.url;
      
      // 3. NAME UPDATE (FAILSAFE)
      // Only attempt to change the name if the token actually HAS text
      // and we successfully saved the original name.
      if (item.text && item.metadata[METADATA_ORIGINAL].name) {
          const suffix = ` (${shape.name})`;
          if (!item.text.plainText.includes(suffix)) {
              item.text.plainText = `${item.metadata[METADATA_ORIGINAL].name}${suffix}`;
          }
      }
    }
  });
  
  OBR.notification.show(`Transformed into ${shape.name}`);
}

async function handleRevert(context) {
    const ids = context.items.map(i => i.id);
    restoreItems(ids);
}

// New helper for the UI button
async function revertSelection() {
    const selection = await OBR.player.getSelection();
    if(selection && selection.length > 0) {
        restoreItems(selection);
    }
}

async function restoreItems(ids) {
    await OBR.scene.items.updateItems(ids, (items) => {
        for (let item of items) {
            const original = item.metadata[METADATA_ORIGINAL];
            if (original) {
                // RESTORE (Minimal)
                item.image.url = original.url;
                
                // We restore these just in case the user manually resized the token 
                // while it was wildshaped, so they get their original size back.
                if (original.scale) item.scale = original.scale;
                if (original.width) item.image.width = original.width;
                if (original.height) item.image.height = original.height;
                if (original.offset) item.image.offset = original.offset;
                if (original.rotation !== undefined) item.rotation = original.rotation;
                
                // RESTORE NAME (FAILSAFE)
                // Only restore if the token has text and we have a name saved
                if (item.text && original.name) {
                    item.text.plainText = original.name;
                }
                
                delete item.metadata[METADATA_ORIGINAL];
            }
        }
    });
    OBR.notification.show("Reverted to original form");
}

async function saveShapeToLibrary() {
    const nameInput = document.querySelector("#input-name");
    const sizeInput = document.querySelector("#input-size");
    
    const name = nameInput.value;
    const size = sizeInput.value;
    
    if(!name) {
        OBR.notification.show("Please enter a name for the shape.", "ERROR");
        return;
    }
    
    if(!currentSelectedImage) {
        OBR.notification.show("No image found on selected token.", "ERROR");
        return;
    }

    const newShape = {
        id: Date.now().toString(),
        name: name,
        size: size || 1, 
        url: currentSelectedImage
    };

    const newLibrary = [...availableShapes, newShape];
    await OBR.room.setMetadata({ [METADATA_LIBRARY]: newLibrary });

    nameInput.value = "";
    OBR.notification.show(`Added ${name} to library`);
}

async function deleteShape(shapeId) {
    const newLibrary = availableShapes.filter(s => s.id !== shapeId);
    await OBR.room.setMetadata({ [METADATA_LIBRARY]: newLibrary });
}

// --- UI HELPERS ---

async function updateSelectionUI(selection) {
    const addBtn = document.querySelector("#btn-add-shape");
    const previewArea = document.querySelector("#preview-area");
    const previewImg = document.querySelector("#preview-img");
    const msg = document.querySelector("#selection-msg");
    const libMsg = document.querySelector("#view-library p");
    const revertBtn = document.querySelector("#btn-revert-ui");

    if (!addBtn) return;
    
    // Reset selection state
    currentSelectedImage = null;

    if (selection && selection.length > 0) {
        const items = await OBR.scene.items.getItems(selection);
        
        if(items.length > 0 && items[0].image) {
            const item = items[0];

            // CHECK: Is this token already Wild Shaped?
            if (item.metadata && item.metadata[METADATA_ORIGINAL]) {
                // LIBRARY TAB: Show Error
                if (libMsg) {
                    libMsg.innerText = "Cannot add: Token is already Transformed.";
                    libMsg.style.color = "#ff6666";
                }
                addBtn.disabled = true;
                addBtn.innerText = "Revert Token First";
                previewArea.style.display = "none";

                // TRANSFORM TAB: Show Revert Button
                if (msg) msg.style.display = 'none'; // Hide "Select a token..."
                if (revertBtn) revertBtn.style.display = 'block';

                return;
            }

            // Valid Token (Original Form)
            // TRANSFORM TAB: Reset
            if (msg) {
                msg.style.display = 'none';
                msg.innerText = "Select a token to shape...";
                msg.style.color = "";
            }
            if (revertBtn) revertBtn.style.display = 'none';

            // LIBRARY TAB: Reset
            if (libMsg) {
                libMsg.innerText = "Select a token on the map to use its image.";
                libMsg.style.color = "";
            }

            addBtn.disabled = false;
            addBtn.innerText = "Save Selected Token";
            
            currentSelectedImage = items[0].image.url;
            previewArea.style.display = "block";
            previewImg.src = currentSelectedImage;
        } else {
            // Not an image
            if (msg) {
                msg.style.display = 'block';
                msg.innerText = "Select an Image Token";
                msg.style.color = "";
            }
            if (revertBtn) revertBtn.style.display = 'none';

            if (libMsg) {
                libMsg.innerText = "Select an Image Token";
                libMsg.style.color = "";
            }

            addBtn.disabled = true;
            addBtn.innerText = "Select an Image Token";
            previewArea.style.display = "none";
        }
    } else {
        // Nothing selected
        if (msg) {
            msg.style.display = 'block';
            msg.innerText = "Select a Token First";
            msg.style.color = "";
        }
        if (revertBtn) revertBtn.style.display = 'none';
        
        if (libMsg) {
            libMsg.innerText = "Select a token on the map to use its image.";
            libMsg.style.color = "";
        }
        
        addBtn.disabled = true;
        addBtn.innerText = "Select a Token First";
        previewArea.style.display = "none";
    }
}

function renderShapeList() {
    const container = document.querySelector("#shape-container");
    if (!container) return;
    container.innerHTML = "";
    
    if (availableShapes.length === 0) {
        container.innerHTML = "<p style='color:#777; font-style:italic; padding:10px;'>No shapes saved yet.</p>";
        return;
    }
    
    availableShapes.forEach(shape => {
        const div = document.createElement("div");
        div.className = "shape-card";
        div.innerHTML = `
            <img src="${shape.url}" class="shape-img">
            <div class="shape-info">
                <span class="shape-name">${shape.name}</span>
                <span class="shape-size">Size: ${shape.size || 1}x${shape.size || 1}</span>
            </div>
            <button class="primary" style="width:auto; padding: 4px 10px;">Transform</button>
        `;
        
        const btn = div.querySelector("button");
        btn.addEventListener("click", () => applyShape(shape));
        
        container.appendChild(div);
    });
}

function renderLibraryList() {
    const container = document.querySelector("#library-list");
    if (!container) return;
    container.innerHTML = "";

    availableShapes.forEach(shape => {
        const div = document.createElement("div");
        div.className = "shape-card";
        div.innerHTML = `
            <img src="${shape.url}" class="shape-img">
            <div class="shape-info">
                <span class="shape-name">${shape.name}</span>
            </div>
            <button class="danger" style="width:auto; padding: 4px 10px;">X</button>
        `;
        
        const btn = div.querySelector("button");
        btn.addEventListener("click", () => deleteShape(shape.id));
        
        container.appendChild(div);
    });
}

function setupTabs() {
    const tabs = document.querySelectorAll(".tab");
    console.log("[WildShape] Setting up tabs:", tabs.length);
    
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            console.log("[WildShape] Tab clicked:", tab.dataset.target);
            
            // Remove active from all
            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            // Hide all views
            document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
            
            // Activate this
            tab.classList.add("active");
            
            // Show target
            const targetId = tab.dataset.target;
            const targetView = document.getElementById(targetId);
            if (targetView) {
                targetView.classList.remove("hidden");
            } else {
                console.error("[WildShape] Target view not found:", targetId);
            }
        });
    });
    
    const btn = document.querySelector("#btn-add-shape");
    if(btn) btn.addEventListener("click", saveShapeToLibrary);

    // INJECT REVERT BUTTON (Bottom Right Fixed)
    const transformView = document.getElementById("view-transform");
    if (transformView && !document.getElementById("btn-revert-ui")) {
        const revertBtn = document.createElement("button");
        revertBtn.id = "btn-revert-ui";
        revertBtn.className = "danger";
        revertBtn.innerText = "Revert Form";
        
        // STYLING FOR BOTTOM RIGHT POSITIONING
        revertBtn.style.display = "none";
        revertBtn.style.position = "fixed";
        revertBtn.style.bottom = "15px";
        revertBtn.style.right = "15px";
        revertBtn.style.width = "auto";
        revertBtn.style.padding = "8px 16px";
        revertBtn.style.zIndex = "1000";
        revertBtn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.5)";
        
        revertBtn.addEventListener("click", revertSelection);
        
        // Append to the view so it is part of the transform tab
        transformView.appendChild(revertBtn);
    }
}

