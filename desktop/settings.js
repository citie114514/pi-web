"use strict";

// Settings for the desktop shell: close behaviour and the remembered window
// position, stored as JSON in Electron's userData directory.
//
// Kept free of Electron imports so it can be tested against a temporary file,
// and defensive on read: a hand-edited or truncated file must never stop the
// app from starting.

const fs = require("node:fs");
const path = require("node:path");

const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 480;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate remembered window bounds.
 *
 * @returns {{ x?: number, y?: number, width: number, height: number } | null}
 *   `x`/`y` stay optional: a window only has a position once it has been moved.
 */
function normalizeBounds(raw) {
  if (!raw || typeof raw !== "object") return null;

  const { x, y, width, height } = raw;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT) return null;

  const bounds = { width: Math.round(width), height: Math.round(height) };
  if (isFiniteNumber(x) && isFiniteNumber(y)) {
    bounds.x = Math.round(x);
    bounds.y = Math.round(y);
  }
  return bounds;
}

/** A maximized, fullscreen, or minimized window must not overwrite its size. */
function isPersistableWindowState({ isMaximized, isFullScreen, isMinimized }) {
  return !isMaximized && !isFullScreen && !isMinimized;
}

function createSettingsStore(filePath) {
  function readAll() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      // Missing or unreadable settings must never break startup.
      return {};
    }
  }

  function writeAll(values) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  }

  return {
    filePath,
    all: readAll,
    get(key, fallback) {
      const values = readAll();
      return Object.hasOwn(values, key) ? values[key] : fallback;
    },
    set(key, value) {
      const values = readAll();
      values[key] = value;
      writeAll(values);
      return value;
    },
    delete(key) {
      const values = readAll();
      delete values[key];
      writeAll(values);
    },
    getWindowBounds() {
      return normalizeBounds(this.get("windowBounds", null));
    },
    setWindowBounds(bounds) {
      const normalized = normalizeBounds(bounds);
      if (!normalized) return null;
      this.set("windowBounds", normalized);
      return normalized;
    },
  };
}

module.exports = {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  createSettingsStore,
  isPersistableWindowState,
  normalizeBounds,
};
